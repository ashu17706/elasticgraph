'use strict'
const debug = require('debug')('create')
const async = require('async-q')
const Q = require('q')
const _ = require('lodash')

const Cache = require('../cache')
const joinCalculator = require('./graph/joinCalculator')

const Create = class Create {
  constructor(es) {
    this.es = es
  }
  /**
   * Indexes the entity in es. Also stores it in cache, if cache is passed, replacing any older version of same entity from the cache
   * @param {String } id (or id) - optional
   * @param {String} index - optional. Otherwise type + 's' is used as default index.
   * @param {String} type (or _type) - type of entity
   * @param {Object} body - the entity body
   */

  execute(params, cache) {
    const es = this.es
    let flushCacheAtEnd = false
    if (!cache) {
      flushCacheAtEnd = true
      cache = new Cache(this.es)
    }
    const type = params._type || params.type
    const index = params.index || (type + 's')

 		return joinCalculator.resolveForEntity(cache, null, 'index', {_id: params._id || params.id, _type: type, _source: params.body})
		.then((joinedEntity) => {
			return this.es.index.collect({
				index: index,
				type: type,
				id: (params._id || params.id),
				body: joinedEntity._source || joinedEntity.fields 
			})
			.then((res) => {
				const entity = {
					_id: res._id,
					_index: index,
					_type: type,
					_source: joinedEntity._source || joinedEntity.fields 
				}
				params._id = res._id

				const DeepUpdater = require('./update')
				return DeepUpdater.doAllUpdates(cache, null, entity, {update: {set: params.body}})
				.then(() => {
					if (flushCacheAtEnd) {
						return cache.flush()
					} else {
						return Q()
					}
				})
				.then(() => {
					return entity
				})
			})
		})
  }
}

module.exports = Create

if (require.main === module) {
  const EpicSearch = require('../../index')
  const es = new EpicSearch(process.argv[2])
  const cache = new Cache(es)
  es.deep.index({id: 1, type: 'speaker', body: {person: {_id: 899}}})
  .catch(debug)
  .then(debug)
}
