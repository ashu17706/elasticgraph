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
   * @param {[String]} fields to fetch for this entity
   * @param {String || Object} joins The joins to do for this entity
   * */
  execute(params, cache) {
    cache = cache || new Cache(this.es)
    let cached = cache.get(params) || cache.get(params._id + params._type)
    if (cached) {//TODO pick only the fields from nested object, as required by the params. Because cache may have bigger object
      return Q(cached)
    }

    let toFetchFields = fieldsToFetch.resolvePaths(cache.es.config, params._type, params.langs, params.fields) || fieldsToFetch.forEntity(this.es, params._type, params.joins, params.langs)
    if (toFetchFields.length === 0) {
      toFetchFields = undefined
    }
    
    const es = this.es
    //return utils.getEntity(cache, params._id, params._type, toFetchFields)
    return es.get.collect({
      id: params._id,
      type: params._type,
      index: params._index || params._type + 's',
      fields: toFetchFields
    })
    .then((esDoc) => {

      sanitize(es, esDoc, params.langs)

      //Can cache this esDoc by params because it will be updated in memory in the subsequent flow. Let other flows sharing same params use the same esDoc during lifetime of this cache
      //This is based on assumption that 
      cached = cache.get(params._id + params._type)// || cache.get(params)
      if (!cached) {
        //cache.setEntity(esDoc)
        cache.set(params, esDoc)
      } else {
        //Here we update the esDoc with whatever is stored in cached version for every field to fetch
        toFetchFields.forEach((field) => {
          /**if (field.indexOf('.') === 1) {
            return
          }**/
          //NOTE:  Currently not merging from esDoc to cache
          const cachedField = _.get(cached._source, field) || _.get(cached.fields, field)
          if (cachedField) {
            const esDocField = _.get(esDoc.fields, field)
            if (!esDocField) { //maybe cache has the lastest value of this field, as per this dataflow. Copy from there.
              esDoc.fields = esDoc.fields || {}
              _.set(esDoc.fields, field, cachedField)
            } else {
              deepMerge(esDocField, cachedField) //Merge the cached doc with esDoc.
            }
          }
        })
      }

      if (params.joins) {
        return require('./resolveJoins')(
          cache,
          params.langs,
          params.joins,
          esDoc
        )
        .then(() => {
          return esDoc
        })
      } else {
        //debug('no joins for', params._type, params, esDoc)
        return esDoc
      }
    })
  }
}

module.exports = Get

if (require.main === module) {
  const EpicSearch = require('../../index')
  const es = new EpicSearch('/home/master/work/code/epicsearch/newConfig')
  const cache = new Cache(es)
  cache.es.deep.get(
    { _type: 'speaker', _id: '1', fields: ['primaryLanguages.name' ], joins: undefined, langs: [ 'english', 'tibetan' ] }
  )
  .then(function(res) {
    debug(JSON.stringify(res))
  })
  .catch(debug)
}
