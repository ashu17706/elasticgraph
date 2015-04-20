/**
 * Same format as native ES mget Api
 * @param index
 * @param type
 * @param body Either array of body.ids or array of body.docs in format { _index, _type, _id} triple
 */

var _ = require('underscore')
var debug = require('debug')('MGet')
function MGet(es){
  this.es = es
}

MGet.prototype.gobble = function(query){
  debug('about to gobble',query)
  return this.swallow(this.chew(query).instructions)
}

MGet.prototype.chew = function(query){
  var index = query.index || this.es.config.default_index,   
  type = query.type || this.es.config.default_type,
  instructions
  debug('query body ', query.body)
  if(query.body.docs){
    instructions = query.body.docs

    for(var i = 0; i< query.body.length; i += 2){
      if(!instructions[i]._index)
        instructions[i]._index = def_index 
      if(!instructions[i]._type)
        instructions[i]._type = def_type
    }
  } else if(query.body.ids) { 
    instructions = query.body.ids.map(function(id){
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

MGet.prototype.swallow = function(mget_instructions){
  if(!_.isArray(mget_instructions))
    mget_instructions = [mget_instructions]
  debug('about to do mget',mget_instructions)
  return this.es.native.mget({
    body: {docs: mget_instructions}
  })
}

module.exports = MGet

if(require.main === module){

  var EpicSearch = require('../../index')
  var config = require('../../config')
  var es = new EpicSearch(config)
  es.mget({body:{ids:[1,2]}})
  .then(function(res){debug(JSON.stringify(res))})
  /**es.get({body:[{_id:1},{_id:2}]})
  .then(function(res){debug(JSON.stringify(res))})**/
}