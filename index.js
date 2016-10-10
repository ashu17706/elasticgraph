'use strict'
const debug = require('debug')('EpicSearch/Index')
const elasticsearch = require('elasticsearch')
const _ = require('lodash')

const collectFunctions = {
    get: './lib/collect/get/index',
    mget: './lib/collect/get/mget',
    search: './lib/collect/search/index',
    msearch: './lib/collect/search/multi_search',
    bulk: './lib/collect/bulk',
    index: './lib/collect/index/index'
  }

const deepFunctions = {
    index: 'create',
    get: 'get',
    search: 'search',
    link: 'link',
    unlink: 'unlink',
    update: 'update'
  }

const EpicSearch = function(configFolderPath) {

  const config = require('./lib/configLoader')(configFolderPath)
  this.es = new elasticsearch.Client(_.clone(config.elasticsearch))

  this.es.config = config
  this.es.Cache = require('./lib/cache')

  addDslFeature(this.es)
  addCollectFeature(this.es)
  addDeepFeature(this.es)
}

const addDeepFeature = (es) => {
  es.deep = {}
  _.keys(deepFunctions)
  .forEach((fnName) => {
    const DeepFunction = require('./lib/deep/' + deepFunctions[fnName])
    const deepFunction = new DeepFunction(es)
    es.deep[fnName] = function () {
      return deepFunction.execute.apply(deepFunction, arguments)
      .catch((err) => {
        throw err + err.stack
      })
    }
  })
}

const addDslFeature = (es) => {
  const DslEngine = require('./lib/dslEngine')
  es.dsl = new DslEngine(es)
}

const addCollectFeature = (es) => {

  const Aggregator = require('./lib/collect/aggregator')
  const aggregator = new Aggregator(es.config)

  _.keys(collectFunctions)
  .forEach((fnName) => {

    const AggregatingFunction = require(collectFunctions[fnName])
    const fn = new AggregatingFunction(es)

    const aggregatedFn = function() {
      return aggregator.collect(fnName, fn, arguments)
    }

    es[fnName] = es[fnName] || aggregatedFn
    es[fnName].collect = aggregatedFn
  })
}

module.exports = function(configFolderPath) {
  return new EpicSearch(configFolderPath).es
}

