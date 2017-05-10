/**
 * @param index optional. Default config.default_index
 * @param type optional. Default config.defaut_type
 * @param body the instructions in format of native es multi search
 *
 */
var _ = require('lodash')
var debug = require('debug')('MultiSearch')
function MultiSearch(es) {
  this.es = es
}

MultiSearch.prototype.gobble = function(params) {
  return this.swallow(this.chew(params))
}

MultiSearch.prototype.chew = function(params) {
  var def_index = params.index || this.es.config.default_index
  var def_type = params.type || this.es.config.default_type
  var instructions = params.body

  for (var i = 0; i < params.body.length; i += 2) {

    if (!instructions[i].index) {
      instructions[i].index = def_index
    }

    if (!instructions[i].type) {
      instructions[i].type = def_type
    }
  }
  return instructions
}

MultiSearch.prototype.swallow = function(m_search_instructions) {
  return this.es.msearch({
    body: m_search_instructions
  })
}

module.exports = MultiSearch

if (require.main === module) {

  var ElasticGraph = require('../../../index')
  var config = require('../../../config')
  var es = new ElasticGraph(config)

  es.msearch.collect({
    body: [{search_type: 'count'},{query: {termff: {url: 1}}},{},{query: {term: {url: 2}}}]
  })
  .then(function(res) {debug('with wait' , JSON.stringify(res))})
  .catch(function(e) {
    debug('err', e)
  })

  es.msearch.collect({
    body: [{search_type: 'count'},{query: {term: {url: 1}}},{},{query: {term: {url: 2}}}]
  })
  //.then(function(res) {debug('turant', JSON.stringify(res))})
  .catch(function(e) {
    debug('err s', e)
  })
}
