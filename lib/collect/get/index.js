
/**
 * Same format as native ES get Api
 * @param index
 * @param type
 * @param id
 */

var _ = require('lodash')
var debug = require('debug')('epicsearch:collect/get')
var error = debug
error.log = console.log.bind(console)

function Get(es) {
  this.es = es
}

Get.prototype.gobble = function(query) {
  //debug('about to gobble',query)
  return this.swallow(this.chew(query).instructions)
}

Get.prototype.chew = function(query) {

  var instruction = _.omit(_.clone(query), _.isUndefined)
  instruction._index = query.index
  delete instruction.index
  instruction._type = query.type
  delete instruction.type
  instruction._id = query.id
  delete instruction.id
  return {
    instructions: [instruction],
    response_size: 1
  }
}

Get.prototype.swallow = function(mget_instructions) {
  if (!_.isArray(mget_instructions)) {
    mget_instructions = [mget_instructions]
  }
  return this.es.mget({
    body: {
      docs: mget_instructions
    }
  })
  .then(function(res) {
    return res.docs
  })
}

Get.prototype.stripTheArrayResponse = true

module.exports = Get

if (require.main === module) {

  var EpicGet = require('../../../index')
  var es = new EpicGet('/home/master/work/code/epicsearch/newConfig')
  var params = { index: 'speakers',
    type: 'speaker',
    fields: [ 'primaryLanguages.fields.name' ],
    id: '1' }
  es.get.collect(params)
  .then((res) => {debug(JSON.stringify(res), params)})
  .catch(debug)
}
