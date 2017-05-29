'use strict'
const debug = require('debug')('elasticgraph:deep/update')
const updater = require('js-object-updater')
const async = require('async-q')
const Q = require('q')
const _ = require('lodash')

const unionCalculator = require('./graph/unionCalculator')
const joinCalculator = require('./graph/joinCalculator')
const utils = require('./utils')
const Cache = require('../cache')

/**
 *@param {[Object]} entities - Optional. For multiple entities to updated together.
 Otherwise use _id and _type for single entity
 *@param {String} _id - Optional. If updating single entity only, then give its _id and type
 *@param {String} _type - Optional. If updating single entity only, then give its _id and type
 *@param {Boolean} isOwn - In case creating or removing a relation, specify whether the relations are direct relations or derived ones
 *@param {Boolean} dontHandleLinking - whether to call link/unlink in case any updated field is a relationship
 it is own or inferred relation from unionIn
 *@param {Object} update - the instructions to update as per js-object-updater npm
 *@return {Object} with status 201, _id and _type
 */
const DeepUpdater = class DeepUpdater {
  constructor(es) {
    this.es = es
  }

  execute(params, cache) {
    let flushCacheAtEnd = false
    if (!cache) {
      flushCacheAtEnd = true
      cache = new Cache(this.es)
    }
    /**if (!params.dontHandleLinking) {
      debug('With linking', params._type,  JSON.stringify(params.update), params.dontHandleLinking)
    } else {
      debug('WIthout linking', params._type, JSON.stringify(params.update, params.dontHandleLinking))
    }**/
    params.entities = params.entities || [{_id: params._id, _type: params._type}]
    return async.map((params.entities), (e) => {
      return utils.getEntity(cache, e._id, e._type)
    })
    .then((loadedEntities) => {
      return async.each(loadedEntities, (e) => {
        if (!e) {
          return
        }
        const oldEntity = _.cloneDeep(e)
        const updatedEntity = e
        this.applyInMemoryUpdate(updatedEntity, params.update)
        cache.markDirtyEntity(updatedEntity)
        return DeepUpdater.doGraphUpdates(cache, oldEntity, updatedEntity, params)
      })
      .then(() => {
        if (flushCacheAtEnd) {
          return cache.flush()
        }
      })
      .then(() => {
        return {status: 201, _id: params._id, _type: params._type}
      })
    })
  }

  applyInMemoryUpdate(entityFromCache, update) {
    const updatedEntity = entityFromCache
    updater({
      doc: updatedEntity._source || updatedEntity.fields || (updatedEntity.fields = {}),
      update: update,
      force: true
    })
    //debug('applied in memory update. New entity', JSON.stringify(updatedEntity), 'update params', params.update)
    this.trimObject(updatedEntity._source || updatedEntity.fields)

    return updatedEntity
  }

  static doGraphUpdates(cache, entity, updatedEntity, params) {


    const entitySchema = cache.es.config.schema[updatedEntity._type]
    const joinIns = cache.es.config.invertedJoins.index[updatedEntity._type] //Load joins from the index config
    return async.each(_.keys(entitySchema), (field) => {
      const fieldUpdate = DeepUpdater.pluckUpdatesForField(updatedEntity._type, field, params.update, cache.es.config)

      if (entity && _.isEmpty(fieldUpdate)) {//If this field is being updated, and updatedEntity represents a new entity being created
        return Q()
      }
      const updatedField = field

      const fieldSchema = entitySchema[updatedField]

			if (!fieldSchema.isRelationship) { //Reflect the change in non-relationship fields in dependent graph nodes

				const updatePromises = []

				if (joinIns && joinIns[field]) {
					updatePromises.push(
						joinCalculator.recalculateJoinsInDependentGraph(cache, updatedEntity, updatedField, fieldUpdate))
				}

				if (fieldSchema.unionIn) {
					updatePromises.push(
						unionCalculator.recalculateUnionInDependentGraph(cache, entity, updatedEntity, updatedField))
				}

				return Q.all(updatePromises)

			} else if (!params.dontHandleLinking) {

				return Q.all([
					DeepUpdater.handleRemovedLinks(cache, entity, updatedEntity, updatedField, fieldUpdate, params.isOwn),
					DeepUpdater.handleNewLinks(cache, updatedEntity, updatedField, fieldUpdate, params.isOwn)
				])
			}
  })
}

  static handleRemovedLinks(cache, entity, updatedEntity, field, fieldUpdate, isOwn) {
    let entitiesToPull

    if (fieldUpdate.unset) {
      entitiesToPull = entity._source[field]
    } else if (fieldUpdate.pull){

      entitiesToPull = fieldUpdate.pull._value || fieldUpdate.pull._values || fieldUpdate.pull[field] || _.get(fieldUpdate.pull[0], '_value') || _.get(fieldUpdate.pull[0], '_values')  //as per the options for pull in js-object-updater api

    } else { //There is no removed link
      return Q()
    }
    //debug('handle removed', updatedEntity, field, fieldUpdate)

    entitiesToPull = _.isArray(entitiesToPull) && entitiesToPull || [entitiesToPull]
    entitiesToPull = _.compact(entitiesToPull)

    if (_.size(entitiesToPull)) {

      const e2Type = cache.es.config.schema[updatedEntity._type][field].to
      return DeepUpdater.removeLinks(cache, updatedEntity, field, e2Type, entitiesToPull, isOwn)
      //.then(() => debug(updatedEntity))
    } else {
      return Q()
    }
  }

  static removeLinks(cache, updatedEntity, updatedField, e2Type, e2Entities, isOwn) {
    if (!_.size(e2Entities)) {
      return Q()
    }

    e2Entities =
      _.flatten(e2Entities)
      .map(
        (e2) => {
          return {
            _id: e2._id,
            _type: e2Type
          }
        }
      )
    return cache.es.deep.unlink({
        e1: updatedEntity,
        e1ToE2Relation: updatedField,
        e2Entities: e2Entities,
        isOwn: isOwn
      },
      cache
    )
  }

  static handleNewLinks(cache, updatedEntity, field, fieldUpdate, isOwn) {
    /**if (fieldUpdate.addToSet || fieldUpdate.push || fieldUpdate.set) {
      debug('create new link', JSON.stringify(updatedEntity), field, fieldUpdate, 'isOwn', isOwn)
    }**/
    return async.each(['addToSet', 'push', 'set'], (updateType) => {
      if (!fieldUpdate[updateType]) {
        return
      }
      const e2Type = cache.es.config.schema[updatedEntity._type][field].to
      let e2Entities = [fieldUpdate[updateType][field]]

      //debug('handleNewLinkages e2Entities', e2Entities, field, updatedEntity, fieldUpdate)
      e2Entities =
        _.flatten(e2Entities)
        .map(
          (e2) => {
            return {
              _id: e2._id,
              _type: e2Type
            }
          }
        )
      return cache.es.deep.link({
          e1: updatedEntity,
          e1ToE2Relation: field,
          e2Entities: e2Entities,
          isOwn: isOwn,
          dontHandleLinking: true,
          relationPropertyIsSet: true
        },
        cache
      )
    })
  }

  static pluckUpdatesForField(et, field, update, config) {
    if (config.schema[et][field].multiLingual) {
      return DeepUpdater.pluckUpdatesforMultilingualField(field, update, config)
    } else {
      return DeepUpdater.pluckUpdatedForNonLingualField(field,update)
    }
  }

  static pluckUpdatesforMultilingualField(field, update, config) {
    const result = {}
    return _.transform(update, (result, updateTypeInstructions, updateType) => {
      if (!_.isArray(updateTypeInstructions)) {
        updateTypeInstructions = [updateTypeInstructions]
      }
      config.common.supportedLanguages.forEach((lang) => {
        const langFieldPath = [lang, field] 
        const langFieldPathStr = langFieldPath.join('.')

        updateTypeInstructions.forEach((instruction) => {

          //push/pull/set/addToSet
          if (_.get(instruction, langFieldPath)) {
            _.set(result, [updateType, lang, field], instruction[lang][field])
          //unset instruction of the form: '{lang}.fieldA' or ['{lang}.fieldA', '{lang}.fieldB']
          } else if (instruction === langFieldPathStr || _.includes(instruction, langFieldPathStr)) {
            result[updateType] = result[updateType] || []
            if (!_.includes(result[updateType], langFieldPathStr)) {
              result[updateType].push(langFieldPathStr)
            }
          } //unset instruction of the form: {_path: [{lang}, {field}]}
          else if (instruction._path && instruction._path[0] === lang && instruction.path[1] === field) {
            result[updateType] = result[updateType] || []
            result[updateType].push(instruction)
          }
        })
      }) 
    }, result)
  }

  static pluckUpdatedForNonLingualField(field, update) {
    return _.transform(update, (result, updateTypeInstructions, updateType) => {
      if (!_.isArray(updateTypeInstructions)) {
        updateTypeInstructions = [updateTypeInstructions]
      }
      updateTypeInstructions.forEach((instruction) => {
        //push/pull/set/addToSet
        if (instruction[field]) {
          result[updateType] = result[updateType] || {}
          result[updateType][field] = instruction[field]

        //unset instruction of the form: 'fieldA' or ['fieldA', 'fieldB']
        } else if (instruction === field || _.includes(instruction, field)) {
          result[updateType] = result[updateType] || []
          if (!_.includes(result[updateType], field)) {
            result[updateType].push(field)
          }
        } //unset instruction of the form: {_path: ['fieldA']}
        else if (instruction._path && _.first(instruction._path) === field) {
          result[updateType] = result[updateType] || []
          result[updateType].push(instruction)
        }
      })
    }, {})
  }

  trimObject(o) {
    _.each(o, (v, k) => {
      if (_.isNaN(v) || _.isUndefined(v) || _.isNull(v) || (_.isString(v) && _.isEmpty(v)) || (_.isObject(v) && _.isEmpty(v))) {
        delete o[k]
      }
    })
  }
}

module.exports = DeepUpdater

if (require.main === module) {
  const ElasticGraph = require('../../index')
  const es = new ElasticGraph('/home/master/work/code/elasticgraph/newConfig')
  const Cache = require('../cache')
  const cache = new Cache(es)
  debug(DeepUpdater.pluckUpdatesForField('event', 'primaryLanguages', {"unset":[{"_path":["primaryLanguages"]}]}, es.config))
  es.deep.update({
    _id: 1,
    _type: 'video',
    update: {
      /**
      push: {
        x: [567],
        yString: ['ff']
      },
      addToSet: {
        x: [567],
        yString: ['ff']
      },
      set: {
        x: [567, 2],
        yString: ['ffg']
      },
      unset: [
        'x'
      ],**/
      pull: {
        yString: ['ffg']
      },
      push: {
        yString: ['ffi=g']
      },
    }
  }, cache)
  .then((res) => {
    debug(res)
    return cache.flush()
  })
  .catch(debug)
}
