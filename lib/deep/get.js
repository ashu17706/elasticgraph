'use strict'
const debug = require('debug')('epicsearch:deep/get')
const _ = require('lodash')
const deepMerge = require('deepmerge')
const Q = require('q')

const fieldsToFetch = require('./fieldsToFetch')
const sanitize = require('./sanitizeEsResponse')

const Cache = require('../cache')
const utils = require('./utils')

const Get = class Get {
  constructor(es) {
    this.es = es
  }

  /*
   * @param {String} _id
   * @param {String} _type
   * @param {String} _index Optional. Default _type + 's'
   * @param {String || [String]} langs - Optional. If not spcified, the full doc with all language data will be fetched
   * @param {[String]} fieldsToFetch for this entity. If this does not return valid fields to be fetched, the joins param is used to fetch the fields
   * @param {String || Object} joins The joins to do for this entity
   * */
  execute(params, cache) {
    cache = cache || new Cache(this.es)
/**    const cachedPromise = cache.get(params)
    if (cachedPromise) {
      return Q(cachedPromise)
    }**/

		let cached = cache.getEntity(params._type, params._id)

		let getPromise
		if (!cached || !cached._source) {
			getPromise = this.getFromEs(params, cache)
		} else {
			getPromise = Q(cached)
		}

		const returnPromise = getPromise.then((doc) => {
      if (doc && params.joins) {
        return require('./graph/joinCalculator').resolveForEntity(
          cache,
          params.langs,
          params.joins,
         	_.cloneDeep(doc)
        )
      }
      if (_.isEmpty(doc) || doc === null || doc === undefined) {
        debug(params, 'empty doc. Will not be joined')
      }
      return doc
    })

		//cache.set(params, returnPromise)

		return returnPromise
  }

	getFromEs(params, cache) {
		let toFetchFields = params.fields && fieldsToFetch.resolvePaths(cache.es.config, params._type, params.langs, params.fields) || params.joins && fieldsToFetch.forEntity(this.es, params._type, params.joins, params.langs)
		if (_.isEmpty(toFetchFields)) {
			toFetchFields = undefined
		}

		return this.es.get.collect({
			id: params._id,
			type: params._type,
			index: params._index || params._type + 's',
			fields: toFetchFields
		})
		.then((esDoc) => {
			if (!esDoc.found) {
				return
			}

			sanitize.sanitizeEntity(this.es, esDoc, params.langs)

			//Can cache this esDoc by params because it will be updated in memory in the subsequent flow. Let other flows sharing same params use the same esDoc during lifetime of this cache
			//This is based on assumption that
			const cached = cache.getEntity(params._type, params._id)

			if (!cached) {
				if (esDoc._source) {
					cache.setEntity(esDoc)
				}

			} else {

				//Here we update the esDoc with whatever is stored in cached version for every field to fetch
				(toFetchFields || _.keys(cache.es.config.schema[esDoc._type])).forEach((field) => {
					const cachedField = _.get(cached._source, field) || _.get(cached.fields, field)
					if (cachedField && !_.isEmpty(cachedField)) {
						const esDocField = _.get(esDoc.fields, field)
						if (!esDocField) { //maybe cache has the lastest value of this field, as per this dataflow. Copy from there.
							esDoc.fields = esDoc.fields || {}
							_.set(esDoc.fields, field, cachedField)
						} else {
							_.set(esDoc.fields, field, deepMerge(esDocField, cachedField)) //Merge the cached doc with esDoc.
						}
					}
				})
			}

			return esDoc
		})
		.catch((e) => {
			debug(e, params, toFetchFields)
			throw e
		})
	}
}
module.exports = Get

if (require.main === module) {
  const EpicSearch = require('../../index')
  const es = new EpicSearch(process.argv[2])
  const cache = new Cache(es)
  cache.es.deep.get(
		{"_id":"de191cbbc1dbd4a70fb184c3d0f2b7d561ae2be6","_type":"event","lang":["english","tibetan"]}
  )
  .then(function(res) {
    debug(JSON.stringify(res))
  })
  .catch(debug)
}
