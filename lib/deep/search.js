'use strict'
const debug = require('debug')('deep/search')
const _ = require('lodash')
const async = require('async-q')
const Q = require('q')
const fieldsToFetch = require('./fieldsToFetch')
const sanitize = require('./sanitizeEsResponse')
const Cache = require('../cache')

/***
 *Parameters for search API
 *@param {String} _type type of object to fetch
 *@param {String} q - Optional - Text to query
 *@param {String} query - Optional Elasticsearch query as JSON object
 *@param {String || [String]} langs - Optional. By default all supportedLanguages are used
 *@param {String || Object} joins joins to do for given type
 *@param {[String]} fields fields to fetch for selected entity
 *@param {Integer} from
 *@param {Integer} size
 *@param {Boolean} suggest whether this is a suggest query or not
 *@param {[Object]} filters must clauses in elasticsearch format
 */
const Search = class Search {
  constructor(es) {
    this.es = es
  }

  /**
   * Ensure that if the search response exists in cache, that same cached response is returned. 
   * If not, it must get set in the cache and then returned. 
   * If any hits in response are in the cache, then replace that hit in es.hits.hits 
   * with the document/entity stored in the cache. 
   * If the hit is not found in cache, and contains the _source (is full object), 
   * then set that entity in the cache for future retrievals.
   *
   * @param {Object} params - as specified at top of this file
   * @param {Object} cache
   * @param {Boolean} onlyInCache - search only in cache and not in ES
   */
  execute(params, cache, onlyInCache) {
    const query = this.query(params)
    _.merge(query, query.body)
    delete query.body
    cache = cache || new Cache(this.es)
    const cached = cache.get(query)
    if (cached || onlyInCache) {
      return Q(cached)
    }

    const sanitizeAndResolve = this.sanitizeAndResolve
    const es = this.es
    //else if not in cache
    //debug(JSON.stringify(query))
    return es.search.collect(query)
    .catch((err) => {
      debug('Error in executing search on ES', JSON.stringify(err), JSON.stringify(query))
      throw err
    })
    .then(function(res) {
      return sanitizeAndResolve(cache, res.hits.hits, params)
      .then(function(sanitizedResponse) {
        res.hits.hits = sanitizedResponse
        return res
      })
      .catch((err) => {
        debug('Error in sanitizing ES response', err, 'response', JSON.stringify(res), 'params', JSON.stringify(params))
        throw err
      })
    })
    .then((res) => {
      if (res.hits.total) {
        //Cache each entity in response
        res.hits.hits = res.hits.hits.map((hit, i) => {
          if (cache.getEntity(hit)) {
            return cache.getEntity(hit)
          }
          if (hit._source) { //If this hit contains the exact document as fetched from es
            cache.setEntity(hit)
          }
          return hit
        })
      }
      //Also store full response
      cache.set(query, res)
      return res
    })
    
  }

  sanitizeAndResolve(cache, hits, params) {
    return async.each(hits, (doc) => {
      sanitize.sanitizeEntity(cache.es, doc, params.langs)
      return require('./graph/joinCalculator').resolveForEntity(cache, params.langs, params.joins, doc)
    })
  }

  getAggregations(params) {
    let aggs = {}

    let types = _.flatten([params._type]) 
    if (_.isArray(types) && types.length > 1) { //if this has single type then going ahead
      return aggs
    }

    const lang = this.es.config.common.supportedLanguages[0]

    const fields = _.reduce(this.es.config.aggregations[types[0]], (soFar, path) => {

      const pathSplit = path.split('.')
      let resolvePath = _.last(fieldsToFetch.resolvePath(this.es.config, types[0], [lang], path))
      resolvePath = resolvePath + '.raw'

      _.set(soFar, [pathSplit[0], 'terms', 'field'], resolvePath)

      return soFar
    }, {})

    return fields
  }

  query(params) {

    // debug('params', params)
    let type = params._type
    let toFetchFields
    if (!type) {
      toFetchFields = fieldsToFetch.forEntities(this.es, params.joins, params.langs)
    } else {
      toFetchFields = fieldsToFetch.forEntity(this.es, type, params.joins, params.langs)
    }

    if (_.isEmpty(toFetchFields)) {
      toFetchFields = undefined
    }

    let index
    if (!type) {
      const allEntityTypes = _.keys(this.es.config.schema)
      type = allEntityTypes

      index = allEntityTypes.map((entityType) => {
        return entityType + 's'
      })


    } else if (_.isArray(type)) {

      index = _.map(type, (entityType) => {
        return entityType + 's'
      })

    } else { //type is not array

      index = [type + 's']
      type = [type]

    }
    let aggs = this.getAggregations(params)
    // Empty Query Search
    if (params.q === '') {
      const mustClauses = []
      /*mustClauses.push({
        query_string: {
          query: ''
        }
      })*/

      if (params.filters) {
        _.each(params.filters, (value, key) => {
          mustClauses.push({
            match_phrase: {
              [key]: value        
            }
          })   
        })
      }

      return {
        index: index,
        fields: toFetchFields,
        size: params.size || 10,
        body: {
          query: {
            bool: {
              must: mustClauses
            }
          }
        },
        aggs: aggs
      }
    }

    //Autosuggest search on multiple fields
    if (params.suggest) {

      return this.generateAutosuggestQuery(index, type, toFetchFields, params)
    }

    //Normal search query with either or both of text search clause 'q' and 'query' - a proper json formatted query object for Elasticsearch
    return this.generateNormalQuery(index, type, toFetchFields, params, aggs)
  }

  generateAutosuggestQuery(indices, types, toFetchFields, params) {
    const fieldsToQuery = _.chain(types)
      .reduce((soFar, entityType) => {
        soFar.push(this.autosuggestFields(entityType, params.langs))
        return soFar
      }, [])
      .flatten()
      .uniq()
      .value()

    const multiMatch = {
      multi_match: {
        query: params.q,
        fields: fieldsToQuery
      }
    }

    return {
      index: indices,
      type: types,
      body: {
        query: multiMatch,
        fields: toFetchFields,
        size: params.size || 10
      }
    }
  }

  generateNormalQuery(index, type, toFetchFields, params, aggs) {
    const mustClauses = []

    if (params.q) {
      mustClauses.push({
        query_string: {
          query: params.q
        }
      })
    }
    if (params.query) {
      mustClauses.push(params.query)
    }

    if (params.filters) {
      _.each(params.filters, (value, key) => {
        mustClauses.push({
          match_phrase: {
            [key]: value        
          }
        })   
      })
    }

    return {
      index: index,
      type: type,
      fields: toFetchFields,
      from: params.from || 0,
      size: params.size || 20,
      body: {
        query: {
          bool: {
            must: mustClauses
          }
        }
      },
      aggs: aggs
    }
  }

  autosuggestFields(entityType, langs) {

    langs = !_.isEmpty(langs) && langs || this.es.config.common.supportedLanguages

    const entitySchema = this.es.config.schema[entityType]

    const fields = _.filter(_.keys(entitySchema), function(field) {

      return entitySchema[field]['autoSuggestion']
    })


    return _(fields).map((field) => {

      if (entitySchema[field].multiLingual) {

        return langs.map((lang) => lang + '.' + field + '.' + 'suggest')

      }
      return field + '.' + 'suggest'
    })
    .flatten()
    .value()
  }
}

module.exports = Search

if (require.main === module) {
  const EpicSearch = require('../../index')
  const es = new EpicSearch('/home/master/work/code/epicsearch/newConfig')
  const Cache = require('../cache')
  const cache = new Cache(es)

  es.deep.search({
      _type: 'speaker',
      langs: 'english',
      fields: ['events','primaryLanguages'],
      query: {}
      //context: 'web.search'
    }, cache)
    .catch((err) => {
      debug(JSON.stringify(err))
    })
    .then(function(res) {
      debug(JSON.stringify(res))
    })
}
