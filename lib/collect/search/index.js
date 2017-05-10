/**
 * @param query in format of native es search Api
 *
 */

var _ = require('lodash')
var debug = require('debug')('Search')
function Search(es) {
  this.es = es
}

Search.prototype.gobble = function(query) {
  return this.swallow(this.chew(query))
}

Search.prototype.chew = function(query) {
  var def_index = query.index || this.es.config.default_index
  var def_type = query.type || this.es.config.default_type
  var search_type = query.searchType || query.search_type
 
  delete query.index
  delete query.type
  delete query.search_type
  delete query.searchType

  return [
    {
      index: def_index,
      type: def_type,
      search_type: search_type
    },
    query
  ]
}

Search.prototype.swallow = function(m_search_instructions, numTries) {
	if (!numTries) {
		numTries = 0
	}
  return this.es.msearch({
    body: m_search_instructions
  })
  .catch((err) => {
		if (_.get(err.error.root_cause[0], 'type') === 'es_rejected_execution_exception' || _.get(err.error.caused_by, 'type') === 'es_rejected_execution_exception') {
			if (numTries < 4) {
				return this.swallow(m_search_instructions, ++numTries)
			}
		}
    debug('Error in executing bulk request in ES', JSON.stringify(err), 'instructions', JSON.stringify(m_search_instructions))
    throw err
  })
  .then((res) => {
    return res.responses
  })
}

Search.prototype.stripTheArrayResponse = true

module.exports = Search

if (require.main === module) {
  var EpicGet = require('../../../index')
  var es = new EpicGet('/home/master/work/code/elasticgraph/newConfig')
  es.search.collect({ index: 'speakers', type: 'speaker', fields: ['event', 'primaryLanguages.name']
  })
  .then(function(res) {debug(JSON.stringify(res))})
  .catch((err) => {
    debug(JSON.stringify(err))
  })
  /**es.msearch({
    body: [{search_type:'count'},{query:{term:{url:1}}},{},{query:{term:{url:2}}}]
  })
  .then(function(res) {debug(JSON.stringify(res))})**/
}
