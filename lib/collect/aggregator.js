var  _ = require('lodash')
var Q = require('q')
var utils = require('./utils')
var debug = require('debug')('aggregator')

var Aggregator = function(config) {

  this.config = config
  this.fnsStates = {}

}

Aggregator.prototype.collect = function(fnName, fn, args) {
  var bulkSizes = this.config.collect.batchSizes || {}
  var timeouts = this.config.collect.timeouts || {}

  if (!bulkSizes[fnName] && !timeouts[fnName]) {
    return fn.gobble.apply(fn,args)
  }

  if (!this.fnsStates[fnName]) {//initialize the state

    this.fnsStates[fnName] = {
      requestArgs: [],
      defers: [],
      stripTheArrayResponses: []
    }

  }

  var fnState = this.fnsStates[fnName]
  var deferred = Q.defer()

  //Queue the promise and and request arguments to the function state
  fnState.defers.push(deferred)
  fnState.requestArgs.push(args)
  //Also set array stripping. It may be overriden later in process_bulk
  fnState.stripTheArrayResponses.push(fn.stripTheArrayResponse)

  if (bulkSizes[fnName] && (bulkSizes[fnName] <= fnState.requestArgs.length)) {//bulk limit crossed

    this.flush(fnName,fn)

  } else if (fnState.requestArgs.length == 1 && timeouts[fnName]) {//This is first request being queued

    var that = this//Set the timeout as soon as we see first request
    //All later requests will be.collectregated within this timeout
    fnState.flushTimeout = setTimeout(function() {

      clearTimeout(fnState.flushTimeout)
      delete fnState.flushTimeout
      //debug('firing functions after timeout ', fnName)
      that.flush(fnName,fn)

    },
      timeouts[fnName]
    )
  }

  return deferred.promise
}

Aggregator.prototype.flush = function(fnName, fn) {

  var fnState = this.fnsStates[fnName]

  //Clear the state for next batch of results
  this.fnsStates[fnName] = null

  if (fnState.flushTimeout) { //clear it
    clearTimeout(fnState.flushTimeout)
    delete fnState.flushTimeout
  }

  //Now process all the requestArgs together in a single call
  this.process_bulk(fn, fnState, fnState.requestArgs)
  .then(function(results) {

    //Results must be resolved in same order as requestArgs
    //
    _.values(results).forEach(function(res,i) {
      if (!res) {
        fnState.defers[i].resolve()
      }

      var containerKey = res.responses && 'responses' || res.docs && 'docs' || res.items && 'items'

      var result = containerKey && res[containerKey] || res

      if (result && (result.error || result.err)) {//  utils.hasError(result)) {

        fnState.defers[i].reject(res)
      } else {

        fnState.defers[i].resolve(res)
      }
    })
  })
  .catch(function(err) {
    fnState.defers.forEach(function(defer) {
      defer.reject(err)
    })
  })
}

Aggregator.prototype.process_bulk = function(fn, fnState, reqsArgs) {

  var bulkInstructions = {}
  var responseSizes = {}
  var finalResults = {}

  var promises = reqsArgs.map(function(requestArgs,i) {
    return Q.fcall(function() {

      return fn.chew.apply(fn,requestArgs)

    })
    .then(function(chewed) {
      if (_.isArray(chewed)) {

        responseSizes[i] = chewed.length / 2
        bulkInstructions[i] = chewed

      } else if (chewed) {

        responseSizes[i] = chewed.response_size
        bulkInstructions[i] = chewed.instructions
        fnState.stripTheArrayResponses[i] = fnState.stripTheArrayResponses[i] || chewed.stripTheArrayResponse

      } else {
        throw new Error('empty response from chew in ',fn, requestArgs)
      }
    })
    .catch(function(err) {

      finalResults[i] = { error: err }

    })
  })

  return Q.allSettled(promises)
  .then(function() {

    //Make bulk_instiructions
    return _.flatten(_.values(bulkInstructions))

  })
  .then(function() {
    return fn.swallow.apply(fn,arguments)
  })
  .then(function(results) {

    var containerKey = results.responses && 'responses' || results.docs && 'docs' || results.items && 'items'

    var resultsArray = containerKey && results[containerKey] || results

    resultsArray = utils.split_by_counts(resultsArray, responseSizes)

    /**if (containerKey) {

      delete results[containerKey]
    }**/

    var j = 0

    _.keys(bulkInstructions)
    .forEach(function(i) {

      var stripTheArrayResponse = fnState.stripTheArrayResponses[i]

      finalResults[i] = finalResults[i] || (stripTheArrayResponse && resultsArray[j++][0]) || resultsArray[j++]

      if (containerKey) {//wrap the individual response back in containerKey
        var resultObject = _.clone(results)
        resultObject[containerKey] = finalResults[i]
        finalResults[i] = resultObject
      }

    })

    return finalResults

  })
}

module.exports = Aggregator
