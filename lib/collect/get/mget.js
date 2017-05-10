/**
 * Same format as native ES mget Api
 * @param index
 * @param type
 * @param body Either array of body.ids or array of body.docs in format { _index, _type, _id} triple
 */

var _ = require('lodash')

var debug = require('debug')('MGet')
var error = debug
error.log = console.error.bind(console)

function MGet(es) {
  this.es = es
}

MGet.prototype.gobble = function(query) {

  return this.swallow(this.chew(query).instructions)
}

MGet.prototype.chew = function(query) {
  var index = query.index || this.es.config.default_index
  var type = query.type || this.es.config.default_type
  var instructions

  if (query.body.docs) {

    instructions = query.body.docs

    for (var i = 0; i < query.body.length; i += 2) {

      if (!instructions[i]._index) {
        instructions[i]._index = index
      }

      if (!instructions[i]._type) {
        instructions[i]._type = type
      }
    }
  } else if (query.body.ids) {
    instructions = query.body.ids.map(function(id) {
      return {
        _index: index,
        _type: type,
        _id: id
      }
    })
  } else {
    throw new Error('Either body.docs || body.ids should be defined')
  }

  return {
    instructions: instructions,
    response_size: instructions.length
  }
}

MGet.prototype.swallow = function(mgetInstructions) {

  if (!_.isArray(mgetInstructions)) {
    mgetInstructions = [mgetInstructions]
  }

  return this.es.mget({
    body: {docs: mgetInstructions}
  })
}

module.exports = MGet

if (require.main === module) {

  var ElasticGraph = require('../../../index')
  var config = require('../../../config')
  var es = new ElasticGraph(config)

  es.mget.collect({index: 'tests',type: 'test',body: {ids: [1]}})
  .then(function(r) {
    debug('res', JSON.stringify(r))
  })
  .catch(function(err) {
    error('erroed out', err)
  })
}
