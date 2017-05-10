var _  = require('lodash')

var debug = require('debug')('Index')
var error = debug
error.log = console.log.bind(console)

/**
 * @param body the doc to be inserted. Can have _id in it too
 * @param index the index in which to insert
 * @param type of document
 * @param id of document
 * @param rest same as es params
 */

function Index(es) {
  this.es = es
}

Index.prototype.gobble = function(params) {
  return this.swallow(this.chew(params))
}

Index.prototype.chew = function(params) {

  return [
    {
      index:  {
        _index: params.index,
        _type: params.type,
        _id: params.id
      }
    },
    params.body
  ]
}

Index.prototype.swallow = function(commands) {

  return this.es.bulk({body: commands})
  .then(function(res) {

    return res.items.map(function(i) {

      if (res.error) {

        return res
      }

      var ret = i.index? i.index: i.create
      ret.created = ret.status === 200? false: true
      return ret
    })
  })
}

Index.prototype.stripTheArrayResponse = true
module.exports = Index


if (require.main === module) {
  var ElasticGraph = require('../../../index')
  var config = require('../../../config')
  var es = new ElasticGraph(config)
  es.index.collect({body: {url: '13s'}, id: 'f5S6uh2s75PtU4-A', index: 'test1', type: 'test1'})
  .then(debug)
  .catch(function(e) {
    error('e', e)
  })
  /**es.index.collect({body: {url: 11}, id: 'JIMM5jsORUeb7QFtsQrXkA', index: 'test1', type: 'test1'})
  .then(debug)
  .catch(error)
  es.index({body: {url: 12}, index: 'test1', type: 'test1'})
  .then(debug)**/
}
