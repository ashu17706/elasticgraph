/**
 * Different version that native elasticsearch get. It returns
 * first document matching a particular key === value condition.
 * If not found, it returns null
 *
 *@param index The index to search on. Default is config.default_index
 *@param type The type of document to be matched. Default is epicdoc
 *@param key The field on which to do term query to get first document matching it
 *@param val The value to match for given key
 *@param match Optional. The type of match to do like match_phrase. If not specified, term match is done
 *@param sort How to sort the duplicates for key:  val
 *@param fields array of stored fields to fetch from ES object. Optional. If not specified the whole object is returned
 */
var _ = require('lodash')
var debug = require('debug')('GetFirst')

function GetFirst(es) {
  this.es = es
}

GetFirst.prototype.gobble = function(params) {

  return this.swallow(this.chew(params))

}

GetFirst.prototype.chew = function(params) {
  var stripTheArrayResponse = false

  if (!_.isArray(params.val)) {
    stripTheArrayResponse = true
    params.val = [params.val]
  }

  var instructions =
    _.chain(params.val)
    .map(function(val) {

      var queryType = params.match || 'term'
      var query = {}

      var matchPair = {}
      matchPair[params.key] = val

      query[queryType] = matchPair

      return [
        {
          index:  params.index,
          type:  params.type
        },
        {
          query: query,
          sort:  params.sort,
          fields:  params.fields,
          size: 1
        }
      ]

    }).
    flatten().
    value()

  return {
    response_size:  instructions.length / 2,
    instructions:  instructions,
    stripTheArrayResponse:  stripTheArrayResponse
  }
}


GetFirst.prototype.swallow = function(mSearchInstructions) {

  return this.es.msearch.collect({

    body:  mSearchInstructions

  }).
  then(function(es_res) {

    return es_res.responses.map(function(resp,i) {

      if (resp.error) {
        return resp
      }

      if (!resp.hits.total) {

        return {
          total: 0
        }

      } else {

        var doc = resp.hits.hits[0]
        if (doc._source) {

          doc._source._id = doc._id
          return {
            doc:  doc._source,
            total:  resp.hits.total
          }

        } else {

          doc.fields || (doc.fields =  {})
          doc.fields._id = doc._id
          var requestedFields = mSearchInstructions[2 * i + 1].fields

          if (!requestedFields) {
            return {
              doc:  doc.fields,
              total:  resp.hits.total
            }
          }

          var returnedFields = doc.fields

          requestedFields.forEach(function(field) {

            if (returnedFields[field] && returnedFields[field].length == 1) {
              returnedFields[field] = returnedFields[field][0]

            }
          })

          return {
            doc:  returnedFields,
            total:  resp.hits.total
          }

        }
      }
    })
  })
}

module.exports = GetFirst

if (require.main === module) {
  var ElasticGraph = require('../../../index')
  var config = require('../../../config')
  var es = new ElasticGraph(config)

  es.get_first({
    index:  'test', type:  'test', key:  'url',
    val:  '12', match: 'match_phrase'//,  sort: {fetch_time: 'asc'}, fields: ['fetch_time']
  })
  .then(debug)
  .catch(debug)
}
