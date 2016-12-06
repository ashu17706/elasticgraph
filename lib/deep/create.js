'use strict'
const debug = require('debug')('create')
const async = require('async-q')
const Q = require('q')
const _ = require('lodash')
const crypto = require("crypto");

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
		const newEntity = {
			_id: params.id || params._id || crypto.randomBytes(20).toString('hex'),
			_type: type,
			_index: params.index || (type + 's'),
			_source: params.body
		}

		cache.setEntity(newEntity)

		return es.deep.update({
			_id: newEntity._id,
			_type: newEntity._type,
			update: {set: newEntity._source},
			entityisInCache: true,
			isOwn: true
		}, cache)
		.then(() => { //deep.update also would have saved the updated Entity in cache
			if (flushCacheAtEnd) {
				return cache.flush()
				.then(() => {
					return _.pick(newEntity, ['_id', '_type'])
				})
			} else {
				return _.pick(newEntity, ['_id', '_type'])
			}
		})
  }
}

module.exports = Create

if (require.main === module) {
  const EpicSearch = require('../../index')
  const es = new EpicSearch(process.argv[2])
  const cache = new Cache(es)
  //es.deep.index({id: 1, type: 'speaker', body: {person: {_id: 899}}})
	es.deep.index({"_type":"event","context":"index","lang":["english","tibetan"],"body":{"english":{"title":"aaa"},"archiveNotes":"ffggf","tibetan":{"title":"vvv"}, primaryLanguages: [{_id: 1}]}})
  .catch(debug)
  .then(debug)
}
