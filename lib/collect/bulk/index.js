var _  = require('lodash')

var debug = require('debug')('Bulk')


/**
 * @param index the default index in which to insert
 * @param type default for documents
 * @param body
 */

function Bulk(es) {
  this.es = es
}

Bulk.prototype.gobble = function(params) {

  return this.swallow(this.chew(params))
}

Bulk.prototype.chew = function(params) {

  var instructions = params.body
  var skipNext = false
  var instructionsCount = 0
  instructions.forEach(function(instruction) {

    if (skipNext) {
      skipNext = false
      return
    }

    var key = Object.keys(instruction)[0]

    instructionsCount++

    if (key === 'delete') {
      skipNext = false
    }

    instruction[key]._index = instruction[key]._index || params.index
    instruction[key]._type = instruction[key]._type || params.type

  })

  var result = {
    instructions: instructions,
    response_size: instructionsCount
  }
  return result
}

Bulk.prototype.swallow = function(commands) {
  return this.es.bulk({body: commands})
}

module.exports = Bulk

if (require.main === module) {

  var EpicSearch = require('../../../index')
  var config = require('../../../config')
  var es = new EpicSearch(config)

  es.bulk.collect({body: [{delete: {_type: 'test', _index: 'tests', _id: '1'}}]})
  .then(function(res) {debug(JSON.stringify(res)); return true})
  .catch(debug)

  /**es.bulk.collect({body: [{index: {_id: 'Wase5HP7Tb6WlLzNSSbvzA'}},{url: 14},{index: {_index: 'tests', _type: 'test', _id: 1}},{url: 12}], index: 'tests', type: 'test'})
  .then(function(res) {debug(JSON.stringify(res)); return true})
  .catch(debug)**/

  /**es.bulk_index.collect({docs:[{url:12,_id:1}]})
  .then(debug)
  es.bulk_index.collect({docs:[{url:13}]})
  .then(debug)**/
}
