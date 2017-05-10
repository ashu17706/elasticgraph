var _  = require('lodash')

var debug = require('debug')('IndexBulk')
var utils = require('../utils')


/**
 * @param docs to be inserted. Can be a single doc or an array of docs
 * @param index the index in which to insert
 * @param type of documents
 */

function IndexBulk(es) {
  this.es = es
}

IndexBulk.prototype.gobble = function(params) {
  return this.swallow(this.chew(params))
}

IndexBulk.prototype.chew = function(params) {

  var docs = params.docs
  var index = params.index || this.es.config.default_index
  var type = params.type || this.es.config.default_type

  if (!Array.isArray(docs)) {
    docs = [docs]
  }

  return _.chain(docs)
    .map(function(doc) {

      var commands = [
        {index:  { _index: index, _type: type, _id: doc._id} },
        doc
      ]
      delete doc._id //The _id is specified in header already
      return commands
    })
    .flatten()
    .value()
}

IndexBulk.prototype.swallow = function(commands) {

  var that = this

  return this.es.bulk({body: commands})
  .then(function(res) {

    //Copy the _ids from response into the bulk insert command for the clone index. We want to reuse the same _ids on both
    if (that.es.cloneClient) {

      res.items.forEach(function(item,i) {
        commands.body[2 * i].index._id = utils.only_value(item)._id
      })
      that.es.cloneClient.bulk(commands)
    }

    return res
  })
}

module.exports = IndexBulk

if (require.main === module) {

  var ElasticGraph = require('../../../index')
  var config = require('../../../config')
  var es = new ElasticGraph(config)

  es.bulk_index({docs: [{url: 13},{url: '1233r', _id: 1}], index: 'test1', type: 'test1'})
  .then(debug)
  .catch(function(e) {
    debug('err', e)
  })
}

