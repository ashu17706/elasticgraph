'use strict'
const debug = require('debug')('elasticgraph:deep/unlink')
const async = require('async-q')
const _ = require('lodash')
const Q = require('q')
const asyncAwait = require('asyncawait/await');
const suspendable = require('asyncawait/async');

const utils = require('./utils')
const Cache = require('../cache')
const inboundGraphUpdater = require('./graph/inboundUpdater')
/**
 * Unlink entities of a particular type, along a particular relationship and id,
 * with entities of possibly different types. The linking goes through provided:
 * a. Schema.e1.e1toE2Relation definition exists
 * b. All e2 types are allowed as per schema.e1.e1ToE2Relation definition
 * c. If the reverse relationship name is specified in schema.e1.e1Relation,
 *    and is specified in e2 schema,
 *    and it carries e1ToE2Relation as the reverse name under which e1Type is valid destination
 *
 * If the operation is not allowed for any combination of e1+e2, then an exception is thrown
 * immediately without applying any changes anywhere.

 * @param {Object} e1
 * @param {String} e1ToE2Relation
 * @param {Object} e2 single entity with _type and _id fields
 * @param {Array<Object>} e2Entities array of objects with _type and _id fields
 * @return {Object} with e1ToE2Relation, e1 and e2 / e2entities
 *
 **/
function Index(es) {
  this.es = es
}

Index.prototype.execute = function(params, cache) {
  const es = this.es
  const config = this.es.config
  let indexEntitiesAtEnd = false
  if (!cache) {
    cache = new Cache(es)
    indexEntitiesAtEnd = true
  }
  const entities = _.flatten([params.e2 || params.e2Entities])
  return async.each(entities, (e2) => {
    return dualUnlink(cache, params.e1, e2, params.e1ToE2Relation, params.isOwn)
  })
  .then(() => {
    if (indexEntitiesAtEnd) {
      return cache.flush()
    } else {
      return
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
        res.e2Entities = asyncAwait(
          async.map(
            params.e2Entities, (e2) => utils.getEntity(cache, e2._id, e2._type)
          )
        )
      }
      return res
    })()
  })
}

const dualUnlink = (cache, e1, e2, e1ToE2Relation, isOwn) => {
  const e1ToE2RelationDef = cache.es.config.schema[e1._type][e1ToE2Relation]
  if (!e1ToE2RelationDef) {
    throw new Error('Relation not found: EntityType: ' + e1._type + '. Relation: ' + e1ToE2Relation)
  }
  const e2ToE1Relation = e1ToE2RelationDef.inName

  return Q.all([
    unlink(cache, e1, e1ToE2Relation, e2, isOwn),
    unlink(cache, e2, e2ToE1Relation, e1, isOwn)]
  )
  .spread((res1, res2) => {
    if (res1 != 'didn\'t unlink' && res2 != 'didn\'t unlink') {
      //debug('just removed link', e1._type, e1ToE2Relation, e2._type)
    }
  })
}

const unlink = (cache, e1, e1ToE2Relation, e2, isOwn) => {
  if (!e1ToE2Relation) {
    return Q()
  }

  return isAlreadyUnlinked(cache, e1, e2, e1ToE2Relation)
  .then((isAlreadyUnlinked) => {
    if (isAlreadyUnlinked) {//Don't need to link
      //debug('already linked', e1._type, e1ToE2Relation, e2._type)
      return Q('didn\'t unlink')
    }

    return updateLinksInE1(cache, e1, e1ToE2Relation, e2, isOwn)
    .then(() => {
      return inboundGraphUpdater.execute(cache, e1, [e1ToE2Relation, e2._id], e2)
    })
  })
}

const isAlreadyUnlinked = (cache, e1, e2, e1ToE2Relation) => {
  return utils.getEntity(cache, e1._id, e1._type)
  .then((e1Full) => {
    return !_.find(_.flatten([e1Full._source[e1ToE2Relation]]), _.pick(e2, '_id'))
  })
}

const updateLinksInE1 = (cache, e1, e1ToE2Relation, e2, isOwn) => {

  const e1Schema = cache.es.config.schema[e1._type]
  const relationSchema = e1Schema[e1ToE2Relation]
  if (!relationSchema) {
    throw new Error('relation ' + e1ToE2Relation + ' not found in ' + e1._type + ' schema')
  }
  if (relationSchema.cardinality === 'many') { //If cardinality is 'many', pull

    if (!isOwn || _.find(e1._source[e1ToE2Relation], {_id: e2._id, own:true})) {
      return cache.es.deep.update({
        _type: e1._type,
        _id: e1._id,
        update: {
          pull: {
            [e1ToE2Relation]: {_id: e2._id}
          }
        }
      }, cache)
      .then(() => {
        if (!_.size(e1[e1ToE2Relation])) {
          delete e1[e1ToE2Relation]
        }
      })
    }
  } else if (!isOwn || e1._source[e1ToE2Relation].own) { //If cardinality is 'one', unset
    return cache.es.deep.update({
      _type: e1._type,
      _id: e1._id,
      update: {
        unset: {
          _path: e1ToE2Relation
        }
      }
    }, cache)
  }

  return Q('didn\'t unlink')
}

module.exports = Index

if (require.main === module) {
  const ElasticGraph = require('../../index')
  const es = new ElasticGraph('/home/master/work/code/elasticgraph/newConfig')
  const Cache = require('../cache')
  const cache = new Cache(es)
  debug(JSON.stringify(cache.es.config.schema))
  es.deep.link({
    e2: {
      _type: 'session',
      _id: '1'
    },
    e1: {
      _type: 'event',
      _id: '1'
    },
    e1ToE2Relation: 'sessions'
  }, cache)
  .then(function(res) {
    debug('cache data', JSON.stringify(cache.data))
    debug('res', JSON.stringify(res))
    return cache.flush()
  })
  .catch(debug)
}
