'use strict'
const debug = require('debug')('epicsearch:deep/link')
const async = require('async-q')
const _ = require('lodash')
const Q = require('q')
const asyncAwait = require('asyncawait/await');
const suspendable = require('asyncawait/async');

const utils = require('./utils')
const Cache = require('../cache')
const inboundGraphUpdater = require('./graph/inboundUpdater')
const unionCalculator = require('./graph/unionCalculator')
const joinCalculator = require('./graph/joinCalculator')
const traverser = require('./graph/traverser')

/**
 * Link entities of a particular type, along a particular relationship,
 * with entities of possibly different types. The linking goes through provided:
 * a. Schema.e1.e1Relation definition exists
 * b. All e2 types are allowed as per schema.e1.e1Relation definition
 * c. If the reverse relationship name is specified in schema.e1.e1Relation,
 *    and is specified in e2 schema,
 *    ande it carries e1Relation as the reverse name under which e1Type is valid destination
 *
 * If the operation is not allowed for any combination of e1+e2, then an exception is thrown
 * immediately without applying any changes anywhere.

 * @param {Object} e1
 * @param {String} e1ToE2Relation
 * @param {Object} e2 single entity with _type and _id fields
 * @param {Array<Object>} e2Entities array of objects with _type and _id fields
 * @param {Boolean} isOwn - Whether this link is created by a direct api call to deep.link or from within deep.update? In earlier case isOwn is true. Latter case it must be falsy.
 * @param {Boolean} relationPropertyIsSet - If true, it is assumed that e2Entities or e2, is already set in e1ToE2Relation. So deep.update is   not called to set the relationship property }
 * @return {Object} with e1ToE2Relation, e1 and e2 / e2entities
 *
 */
const Link = class Link {

  constructor(es) {
    this.es = es
  }

  execute(params, cache) {
    const es = this.es
    const config = this.es.config
    let indexEntitiesAtEnd = false
    if (!cache) {
      cache = new Cache(es)
      indexEntitiesAtEnd = true
    }
    const entities = _.flatten([params.e2 || params.e2Entities])
    return async.each(entities, (e2) => {
      return this.isAlreadyDualLinked(params.e1, e2, params.e1ToE2Relation, cache)
      .then((isAlreadyDualLinked) => {

        if (isAlreadyDualLinked) {

          //debug('already dual linked e1', params.e1._type, 'on relation', params.e1ToE2Relation, 'e2', params.e2._type)

        } else {

          //debug('starting dual linked. E1', params.e1._type, 'e2', e2._type, 'isOwn', params.isOwn)
          return this.dualLink(params.e1, e2, params.e1ToE2Relation, cache, params.isOwn, params.relationPropertyIsSet)
        }
      })
    })
    .then(() => {
      if (indexEntitiesAtEnd) {
        return cache.flush().catch((e) => debug('Error in flushing cache to database', e))
      } else {
        return Q()
      }
    })
    .then(() => {
      return suspendable(() => {
        const res = {
          e2ToE1Relation: params.e1ToE2Relation,
          e1: asyncAwait(utils.getEntity(cache, params.e1._id, params.e1._type))
        }
        if (params.e2) {
          res.e2 = asyncAwait(utils.getEntity(cache, params.e2._id, params.e2._type))
        } else {
          res.e2Entities = asyncAwait(async.map(params.e2Entities, (e2) =>
            utils.getEntity(cache, e2._id, e2._type)
          ))
        }
        return res
      })()
    })
  }

  dualLink(e1, e2, e1ToE2Relation, cache, isOwn, relationPropertyIsSet) {
    const e1Schema = cache.es.config.schema[e1._type]
    if (!e1Schema) {
      throw new Error('Schema not found: EntityType: ' + e1._type)
    }

    const e1ToE2RelationDef = e1Schema[e1ToE2Relation]
    if (!e1ToE2RelationDef) {
      throw new Error('Relation not found: EntityType: ' + e1._type + '. Relation: ' + e1ToE2Relation)
    }
    const e2ToE1Relation = e1ToE2RelationDef.inName
    return this.makeLink(e1, e1ToE2Relation, e2, cache, isOwn, relationPropertyIsSet)
    .then(() => this.makeLink(e2, e2ToE1Relation, e1, cache, isOwn, relationPropertyIsSet))
  }

  makeLink(e1, e1ToE2Relation, e2, cache, isOwn, relationPropertyIsSet) {
    if (!e1ToE2Relation) {
      return Q()
    }

    return this.isAlreadyLinked(e1, e2, e1ToE2Relation, cache)
    .then((isLinked) => {
      return (isLinked && Q() || this.setRelationPropertyInE1(cache, e1, e1ToE2Relation, e2, isOwn))
      .then(() => {
        //debug(e1._type, e2._type, e2._id)
        return this.e1UnionsAndJoins(cache, e1, e1ToE2Relation, e2)
      })
    })
    //debug('Linking and applying inbound update from e2. E1', e1._type, 'e1ToE2Relation', e1ToE2Relation, 'e2', e2._type, relationPropertyIsSet)
    }

  e1UnionsAndJoins(cache, e1, e1ToE2Relation, e2) {

    const edgePathToE2 = [e1ToE2Relation, e2._id]
    //debug('e1UnionsAndJoins', e1Loaded, edgePathToE2, e2Loaded)
    //Recalculate unions in the graph having e1 connected with e2 through e1ToE2Relation
    return traverser(cache, 'unionFrom', e1, edgePathToE2, e2, (params) => {

      const rightGraphNodeData = (params.rightGraphNode.fields || params.rightGraphNode._source)
      const rightGraphNodeOld = this.getOldValue(cache, params.rightGraphNode, params.rightGraphNodeField, rightGraphNodeData[params.rightGraphNodeField], true)

      return unionCalculator.recalculateUnionInSibling(rightGraphNodeOld, params.rightGraphNode, params.rightGraphNodeField, params.leftNode, params.leftNodeFieldInfo.name, cache)
    })
    .then(() => {

      return traverser(cache, 'joinFrom', e1, edgePathToE2, e2, (params) => {
        //debug(params.edgePathToRightNode, 'dddddddddddddddd')

        return joinCalculator.resolveForEntity(cache, null, 'index', params.leftNode, {[params.edgePathToRightNode[0]]: {_id: params.edgePathToRightNode[1]}}, params.edgePathToRightNode)
      })
    })
  }

/**
 * @private
 * @param entry {Object || String || Array} Can be anything as per the relation schema
 * @param updateAction {Boolean}
 */
  getOldValue(cache, node, field, entry, wasJustAdded) {

    const fieldSchema = cache.es.config.schema[node._type][field]
    const latestEntries = (node._source || node.fields)[field]
    let oldSource = _.cloneDeep(node._source || node.fields)

    if (wasJustAdded) {
      if (_.isArray(fieldSchema.type)) {
        const changedEntries = _.isArray(entry) && entry || [entry]
        oldSource[field]  = _.filter(latestEntries, (e) => {
          if (fieldSchema.isRelationship) {
            return !_.find(changedEntries, {_id: e._id})
          } else {
            return !_.includes(changedEntries, e)
          }
        })
      } else {
        oldSource[field]  = undefined
      }
    } else { //was just removed
      oldSource[field] = fieldSchema.cardinality === 'many' && latestEntries.push(entry) || entry
    }

    const oldNode = _.omit(node, '_source')
    oldNode._source = oldSource
    return oldNode
  }

  isAlreadyDualLinked(e1, e2, e1ToE2Relation, cache) {
    return this.isAlreadyLinked(e1, e2, e1ToE2Relation, cache)
    .then((e1LinkedToE2) => {

      if (!e1LinkedToE2) {
        return false
      }

      const e2ToE1Relation = cache.es.config.schema[e1._type][e1ToE2Relation].inName
      return this.isAlreadyLinked(e2, e1, e2ToE1Relation, cache)
      .then((e2LinkedToE1) => {
        return e2LinkedToE1
      })
    })
  }

  isAlreadyLinked(e1, e2, e1ToE2Relation, cache) {
    return utils.getEntity(cache, e1._id, e1._type)
    .then((e1Full) => {
      if (!e1Full) {
        e1Full = e1
      }
      const e1Body = e1Full._source || e1Full.fields
      const relatedEntities = e1Body && _.flatten([e1Body[e1ToE2Relation]])

      return relatedEntities && _.find(relatedEntities, {_id: e2._id}) || false
    })
  }

  setRelationPropertyInE1(cache, e1, e1ToE2Relation, e2, isOwn) {

    const e1Schema = cache.es.config.schema[e1._type]
    const relationSchema = e1Schema[e1ToE2Relation]
    if (!relationSchema) {
      throw new Error('makeLink: ' + e1ToE2Relation + ' not found in ' + e1._type + ' schema ' + JSON.stringify(e1Schema))
    }
    const linkOp = _.isArray(relationSchema.type) && 'addToSet' || 'set'
    //debug('about to set link in e1', linkOp, e1._type, e1._id, e1ToE2Relation, 'isOwn', isOwn)
    return cache.es.deep.update({
      _type: e1._type,
      _id: e1._id,
      update: {
        [linkOp]: {
          [e1ToE2Relation]: {_id: e2._id, own: isOwn}
        }
      },
      isOwn: isOwn,
      dontHandleLinking: true
    }, cache)
  }
}

module.exports = Link

if (require.main === module) {
  const EpicSearch = require('../../index')
  const es = new EpicSearch(process.argv[2])
  const Cache = require('../cache')
  const cache = new Cache(es)
  es.deep.link({
    e2: {
      _type: 'event',
      _id: '672'
    },
    e1: {
      _type: 'session',
      _id: 'ba779f2e35be5d456832e97cf8eeb8d39cbef933'
    },
    e1ToE2Relation: 'event'
  })
  .then(function(res) {
    _.keys(cache.data).forEach((k) => {
      const e = cache.data[k]
      if (e.isUpdated) {
        debug(e)
      } else {
        debug('not updated', e)
      }
    })
    return cache.flush()
  })
  /**.then(() => {
    return es.dsl.execute(['get session 1'])
  })
  .then((res) => {debug(JSON.stringify(res))})
  .then(() => {
    return es.dsl.execute(['get event 1'])
  })
  .then((res) => {debug(JSON.stringify(res))})
  .then(() => {
    return es.dsl.execute(['get speaker 1'])
  })
  .then((res) => {debug(JSON.stringify(res))})**/
  .catch(debug)
}
