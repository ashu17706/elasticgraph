'use strict'
const async = require('async-q')
const R = require('ramda')
const  _ = require('lodash')
const Q = require('q')
const debug = require('debug')('DslEngine')
const objectUpdater = require('js-object-updater')
const ElsQuery = require('elasticsearch-query');
const esQueryBuilder = new ElsQuery();

const grammar = require('./grammar')
const val = require('./resolve')
const Cache = require('../cache')
const unflatten = require('../utils').unflatten
const sanitizeDoc = require('./sanitizeDoc')

const isTrue = require('./booleanExpression')
const executeAssignment = require('./assignment')

function DslEngine(es) {
  this.es = es
}
/**
 *  @param {String or Array} instructions - Single instruction or sequence of DSL instructions to execute
 *  @param {Object} ctx - Optional. The context for the instructions. Here the state of variables for instructions is stored.
 *  @return {Object} result from last instruction
 *
 */
DslEngine.prototype.execute = function(instructions, ctx) {
  instructions = (_.isArray(instructions) && instructions) || [instructions]
  const parsedInstructions = organizeInstructions(instructions)
  ctx = ctx || new Cache(this.es)
  return executeDeep(parsedInstructions, ctx, this.es)
}

const executeDeep = (parsedInstructions, ctx, es) => {

  return async.eachSeries(parsedInstructions, (instruction) => {

    let mainInstruction = (_.isArray(instruction) && instruction[0]) || instruction
    if (!mainInstruction) {
      throw new Error('empty instruction' + instruction + parsedInstructions)
    }
    if (_.isFunction(mainInstruction)) {
      return mainInstruction.apply(null, [ctx])
    }
    return executeDslInstruction(mainInstruction, ctx, es)
  })
  .then((instructionsResponses) => {
    return _.last(instructionsResponses)
  })
}

const executeDslInstruction = (parsedInstruction, ctx, es) => {
  
  switch (parsedInstruction.command) {
    case 'get': {return executeGet(parsedInstruction, ctx, es)}
    case 'search': {return executeSearch(parsedInstruction, ctx, es)}
    case 'link': {return executeLink(parsedInstruction, ctx, es)}
    case 'unlink': {return executeUnLink(parsedInstruction, ctx, es)}
    case 'async': {return executeAsync(parsedInstruction, ctx, es)}
    case 'unset': {return executeUnset(parsedInstruction, ctx, es)}
    case 'addToSet': {return executeMemUpdate(parsedInstruction, ctx)}
    case 'add': {return executeMemUpdate(parsedInstruction, ctx)}
    case 'index': {return executeIndex(parsedInstruction, ctx, es)}
    case 'boolExpression': {return isTrue(parsedInstruction, ctx)}
    case 'iterateOverIndex': {return iterateOverIndex(parsedInstruction, ctx, es)}
    case 'assignment': {return executeAssignment(parsedInstruction, ctx, es)}
    default: {throw new Error('No handling found for command', parsedInstruction.command)}
  }
}

const organizeInstructions = (instructions) => {
  const result = []
  let prevWasString = false
  instructions.forEach((instruction, i) => {
    if (_.isArray(instruction)) {//Replace last instruction in result with [last, subInstructionArray]
      result[result.length - 1].childInstructions = organizeInstructions(instruction)
    } else {
      if (_.isString(instruction)) {
        try {
          instruction = grammar.parse(instruction)
        }
        catch (e) {
          debug('Error in parsing', instruction, e.stack, e)
          throw e
        }
      }
      result.push(instruction)
    }
  })
  return result
}

const executeGet = (instruction, ctx, es) => {
  const type = val(instruction.type, ctx)
  const as = val(instruction.as, ctx) || type
  const id = val(instruction.id, ctx)
  const joins = val(instruction.joins, ctx)
  return es.deep.get({
    _index: type + 's',
    _type: type,
    _id: id,
    joins: joins
  })
  .then((getRes) => {
    //Since search instruction does not have children instructions, we do not need to clone the ctx passed to it as param. So just setting the property directly in ctx as it will not be shared in different execution flow
    ctx.set(as, getRes)
    return getRes
  })
}

const executeSearch = (instruction, ctx, es) => {
  const type = val(instruction.type, ctx)
  const where = _.omit(val(instruction.where, ctx), (item) => _.isNull(item) || _.isUndefined(item))
  const joins = val(instruction.joins, ctx)
  const def = Q.defer()
  esQueryBuilder.generate(type, where, null, {match: true}, (err, query) => {
    if (err) {
      def.reject(err)
      return
    }
    if (_.get(query.query, ['filtered','query','term','_type'])) {
      delete query.query.filtered.query
    } //esQuery is generating unecessary query to search by _type. Remove that
    const queryToEs = {
      _index: type + 's',
      _type: type,
      query: query.query,
      joins: joins,
      size: (instruction.getFirst && 1) || 20
    }
    es.deep.search(queryToEs)
    .then((searchRes) => {
      if (_.isEmpty(searchRes.hits.hits) && instruction.createIfNeeded) {
        return createAndSetInSearchResponse(ctx, type, where, queryToEs, searchRes)
      }
      return searchRes
    })
    .then((searchRes) => {
      if (_.isEmpty(searchRes.hits.hits)) {
       // debug(searchRes.hits)
      }
      //Since search instruction does not have children instructions, we do not need to clone the ctx passed to it as param. So just setting the property directly in ctx as it will not be shared in different execution flow
      if (instruction.getFirst) {
        const firstHit = searchRes.hits.hits[0]
        if (instruction.as) {
          ctx.set(instruction.as, firstHit)
        }
        def.resolve(firstHit)
      } else {
        if (instruction.as) {
          ctx.set(instruction.as, searchRes)
        }
        def.resolve(searchRes)
      }
    })
    .catch((err) => {
      debug('error is executeSearch', err, 'query', JSON.stringify(queryToEs))
      def.reject(err)
    })
  })
  return def.promise
}
const createAndSetInSearchResponse = (cache, type, body, queryToEs, searchRes) => {
  return create(cache.es, type, body)
  .then((justCreatedDoc) => { //Now handle concurrency cases in creation of this entity
    return cache.es.deep.search(queryToEs, cache, true) //Fetch this search result from cache
    .then((concurrentlyCreatedAndCached)=> { 
      if (concurrentlyCreatedAndCached && !_.isEmpty(concurrentlyCreatedAndCached.hits.hits)) { //The document has been created and cached in meanwhile by some other part of program, and also put into this search result (This same code, run elsewhere)
        es.delete({index: type + 's', type: type, id: justCreatedDoc._id}).done()
        return concurrentlyCreatedAndCached 
      } 
      // Else if no concurrent creation has happened, set this doc in searchResults
      //The following changes in searchRes will also be affected in the cached searchRes as searchRes is cached by query in cache object inside deep.search() function
      searchRes.hits.hits.push(justCreatedDoc)
      searchRes.hits.total = 1
      //return cached searchRes
      return searchRes
    })
  })
}

/**
 * @param {Object} es the elasticsearch client
 * @param {String} type the type of entity to be creatsts.e
 * @param {Object} entity which may be an object with _id/_type/_source or just the body for getting stored as _source
 */
const create = (es, type, entity) => {
  const id = entity._id
  let doc =  _.omit(entity._source || entity.fields || entity, ['_id', '_type'])
  unflatten(doc)
  const sanitizedDoc = sanitizeDoc(es, type, doc)
  return es.deep.index({
    index: type + 's',
    type: type,
    id: id, //If not specified es will create one automatically
    body: sanitizedDoc
  })
  .catch((err) => {
    debug('Error in indexing document in es', err, 'type', type, 'original document', doc, 'sanitized and tried to save', sanitizedDoc)
    throw err
  })
}

const executeLink = (instruction, ctx, es) => {
  instruction = val(instruction, ctx)
  instruction.isOwn = true
  return es.deep.link(instruction)
}

const executeUnLink = (instruction, ctx, es) => {
  instruction = val(instruction, ctx)
  instruction.isOwn = true
  return es.deep.unlink(instruction)
}

const executeAsync = (instruction, ctx, es) => {
  const args = _.map(instruction.args, (arg) => {
    return val(arg, ctx)
  })
  const asyncFunction = val(instruction.func, ctx)
  args.push(instruction)
  args.push(ctx)
  args.push(es)
  if (asyncFunctions[asyncFunction]) {
    return asyncFunctions[asyncFunction](...args)
  } else {
    throw new Error('Currently not handling async function', asyncFunction)
  }

}

const asyncFunctions = {
  /**
   *@param {Array} items
   *@param {Object} ctx
   *@param {instruction} the instruction with childInstructions if applicable
   *
   */
  each: (items, instruction, ctx, es) => {
    return async.each(items, (item) => {
      //Give the child instructions a new ctx environment to set properties in. assocPath makes a shallow clone of the same
      const newCtx = new es.Cache(es, R.assocPath([instruction.as], item, ctx.data))
      return executeDeep(instruction.childInstructions, newCtx, es)
    })
  }
}

const executeIndex = (instruction, ctx, es) => {
  const entity = val(instruction.entity, ctx)

  const type = instruction.type || entity._type
  if (!type) {
    throw new Error('type not specified for index operation', instruction)
  }
  return create(es, type, entity)
  .then((res) => {
    entity._id = res._id
    return entity
  })
}

const executeUnset = (instruction, ctx, es) => {
  const docWithPath = instruction.docWithPath.split('.')
  const doc = val(_.first(docWithPath), ctx)
  const path = _.drop(docWithPath, 1)
   
  if (instruction.deepUpdate) {
    return es.deep.update({
      _id: doc._id,
      _type: doc._type,
      update: {
        unset: [{
          _path: path
        }]
      }
    })
  } //Else is only in memory update
  const updateInstruction = {
      doc: doc,
      update: {
        unset: path
      }
    }
  objectUpdater(updateInstruction)
  return Q(doc)
}

const executeMemUpdate = (instruction, ctx) => {
  const docWithPath = instruction.docWithPath.split('.')
  const doc = val(_.first(docWithPath), ctx)
  const path = _.takeRight(docWithPath, docWithPath.length - 1)
  const updateInstruction = {
      doc: doc,
      update: {}
    }
  let updateCommand = val(instruction.command, ctx)
  if (updateCommand === 'add') {
    updateCommand = 'push'
  }
  updateInstruction.update[updateCommand] = {
    _path: path,
    _value: val(instruction.value, ctx)
  }
  objectUpdater(updateInstruction)
  return doc
}

/**
 * Instruction params
 * @param as
 * @param type
 * @param where - optional
 * @param index 
 * @param childInstructions
 * @param batchSize
 * @param scrollDuration
 *
 */
const iterateOverIndex = (instruction, ctx, es) => {

  instruction.as = val(instruction.as || instruction.type, ctx)
  instruction.batchSize = val(instruction.batchSize, ctx)
  instruction.scrollDuration = val(instruction.scrollDuration, ctx)
  instruction.index = val(instruction.index, ctx)
  instruction.from = val(instruction.from, ctx)
  instruction.type = val(instruction.type, ctx)

  const esQuery = {
    index: instruction.index,
    scroll: instruction.scrollDuration || '30s',
    from: instruction.from || 0,
    size: instruction.batchSize || 100
  }

  
  const deferred = Q.defer()

  if (instruction.where) { //Set the where clause in esQuery
    const whereClause = val(instruction.where, ctx)
    esQueryBuilder.generate(instruction.type, whereClause, null, {match: true}, (err, query) => {
      if (err) {
        deferred.reject(err)
        return
      }
      if (_.get(query.query, ['filtered','query','term','_type'])) {
        delete query.query.filtered.query
      } //esQuery is generating unecessary query to search by _type. Remove that

      esQuery.query = query.query
    })
  }
  
  //debug(JSON.stringify(esQuery))
  scrolledSearchAndExecuteChildrenInstructions(es, esQuery, ctx, instruction)
  .then((res) => {
    deferred.resolve(res)
  })
  .catch((err) => {
    debug('Exception in executing scrolled search', err, 'for query', JSON.stringify(esQuery))
    deferred.reject(err)
  })

  return deferred.promise 
  
}

const scrolledSearchAndExecuteChildrenInstructions = (es, searchQuery, ctx, instruction) => {
  return es.search(searchQuery)
  .then((res) => {
    if (_.isEmpty(res.hits.hits)) {
      //debug('empty response', res)
      return
    }
    let soFar = 0
    return async.whilst(() => !_.isEmpty(res.hits.hits), () => {
      //debug('iterating over index: got hits', (soFar += res.hits.hits.length) && soFar)//, res.hits.hits.map((h) => h._id))
      return asyncFunctions.each(res.hits.hits, instruction, ctx, es)
      .then(() => {
        //debug('iterating over index: sending next query')
        return es.scroll({
          scrollId: res._scroll_id,
          scroll: instruction.scrollDuration || '30s'
        })
        .then((scrollRes) => {
          res.hits.hits = scrollRes.hits.hits
          res._scroll_id = scrollRes._scroll_id
        })
      })
    })
  })
}

module.exports = DslEngine

if (require.main === module) {
  const EpicSearch = require('../../index')
  const es = new EpicSearch(process.argv[2])

  const ctx = new Cache(es, {x: {a: 2, b:[] }})

  //'roleFeatures.translationType is *audioChannel.translationType if *roleType is translator.'
  try {
    const x = grammar.parse(
    'roleType is speaker if *x.c is empty. Else is translator'
    )
    debug(x)
  } catch(e) {
    debug('error', e)
  }
  /**esQuery.generate('event', {'session': {'title': 'x'}}, null, {match: true}, (err, query) => {
    debug(JSON.stringify(query), JSON.stringify(err))
  })**/

  /**return es.dsl.execute([
    'iterate over events as event. Get 10 at a time.',
    [
      (ctx) => debug('ggg', ctx.immutable.event._id)
    ]
  ], ctx)
  .then(debug)
  
  .catch(debug)**/

  /**es.dsl.execute([
    'async each *ids as ida', [
      'get test *ida as idaTest',
      'async each *ids as id', [
        'get test *id as x',
        'addToSet *idaTest._id in *x at _source.y',
        'index *x as type test'
      ]
    ]
  ], {ids: [1, 2]})**/

  const search = ['search first event where {_id: "AVeuJeQ9jGz7t7QfUg_M"}. Join from search. Create if not exists']//, 'search event where {_id: 1} as event2']
  /**return iterateOverIndex({
    as: 'event',
    type: 'event',
    scrollDuration: '10s',
    childInstructions: [(ctx) => debug(ctx.as))],
    size: 5
  }, ctx, es)
  .catch((e) => debug(JSON.stringify(e)))
  .then(() => debug('done'))**/
}
