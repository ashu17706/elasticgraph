'use strict'
const debug = require('debug')('eps:cache')
const updater = require('js-object-updater')
const Q = require('q')
const _ = require('lodash')
const R = require('ramda')
const async = require('async-q')

const Cache = class Cache {
  constructor(es, contextData, immutableData) {
    this.data = contextData || {}
    this.immutable = immutableData || {}
    this.es = es
    //_.merge(this, contextData)
  }
  /**
  * @param {String} key - The key to get cached data for
  * @return the cached data for the given key
  **/
  get(key) {
    if (_.isObject(key) && !_.isArray(key)) {
      key = JSON.stringify(key)
    }
    return _.get(this.data, key) || _.get(this.immutable, key)
  }

  /**
   * @param {String} _type
   * @param {String} _id
   */
  getEntity(_type, _id) {
    return this.get(_id + _type)
  }

  /**
  * Stores entities in cache with key = _id + _type
  * @param {Object} entity - an entity with _id, _type in it
  **/
  setEntity(entity) {
    //debug('setting entity', entity, new Error().stack)
    this.data[entity._id + entity._type] = entity
  }

  /**
  * Sets JSON.stringify(key) = res
  * @param {} key - It is strigified as JSON
  * @param {} res - The object to be stored as value against the key
  **/
  set(key, res) {
    //debug('setting', key, res, new Error().stack)
    if (_.isObject(key) && !_.isArray(key)) {
      key = JSON.stringify(key)
    }
    _.set(this.data, key, res)
  }

  /**
  * Sets JSON.stringify(key) = res in the immutable part of the cache
  * @param {} key - It is strigified as JSON
  * @param {} val - The object to be stored as value against the key
  * @return {Cache} - new Cache object with same data, but immutable object cloned and with updated val/key pair
  **/
  setImmutable(key, val) {
    if (_.isObject(key) && !_.isArray(key)) {
      key = JSON.sringify(key)
    }
    const newImmutable = R.assocPath([key], val, this.immutable)
    return new Cache(this.es, this.data, newImmutable)
  }

  markDirtyEntity(entity) {
    this.markDirty(entity._id + entity._type)
  }

  markDirty(key) {
    let object = this.get(key)
		if (!object) {
			debug('No value found for key', key)
		}
    object.isUpdated = true
  }

	deepFlush() {
		this.flush(true)
	}

  flush(doDeepFlush) {

		//debug(doDeepFlush, _.keys(this.data).length, _(this.data).keys().sample(25).value())
    //Of all the data here, only the entities should be marked updated
    //Rest is read only. This is the expected state. If not happeningm, something is wrong elsewhere in the use of cache elsewhere
    const updatedEntities =
      _(this.data)
      .values()
      .filter((val) => val.isUpdated)
      .uniq((val) => val._id + val._type)
      .value()

	  if (!doDeepFlush) {	
      this.data = {}
    }

		const flushMethod = doDeepFlush && this.es.deep.index || this.es.index.collect
    const errors = []
    //For every updated entity, flush it to ES
    return async.eachLimit(updatedEntities, 200, (updatedEntity) => {
      if (!doDeepFlush) {
				delete updatedEntity.isUpdated
			}
      return flushMethod({ //es.deep.index indexes all the entities in 'this' cache itself, first. Then in ES db.
        index: updatedEntity._index || updatedEntity._type + 's',
        type: updatedEntity._type,
        id: updatedEntity._id,
        body: updatedEntity.fields || updatedEntity._source
      }, this)
      .catch((e) => {
				debug('Error in indexing entity. Deep flush is ', doDeepFlush, 'updatedEntity is', JSON.stringify(updatedEntity), 'Error is', e)
				//throw e
        errors.push(e)
			})
    })
		.then(() => {
			if (doDeepFlush) { //es.deep.index indexes all the entities in 'this' cache itself, first
				return this.flush()
			}
		})
    .then(() => {
      if (errors.length) {
        throw new Error(errors)
      }
    })
  }
}

module.exports = Cache
