'use strict'
const async = require('async-q')
const  _ = require('lodash')
const Q = require('q')
const debug = require('debug')('DslEngine')
const objectUpdater = require('js-object-updater')
const ElsQuery = require('elasticsearch-query');
const esQueryBuilder = new ElsQuery();
const crypto = require('crypto')

const grammar = require('./grammar')
const val = require('./resolve')
const Cache = require('../cache')
const unflatten = require('../utils').unflatten
const sanitizeEntityBody = require('./sanitizeDoc')

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
		let instructionPromise
    if (_.isFunction(mainInstruction)) {
      instructionPromise = Q(mainInstruction.apply(null, [ctx]))
    } else {
    	instructionPromise = Q(executeDslInstruction(mainInstruction, ctx, es))
		}

		return instructionPromise.then((res) => {
      if (res && res instanceof es.Cache) { //The instruction mutates the ctx most probably to generate a new ctx object
        ctx = res
      }
      
      return Q(mainInstruction.as && ctx.get(mainInstruction.as) || res)
  	})
	})
}

const executeDslInstruction = (instruction, ctx, es) => {
	
	let parsedInstruction //The instruction to run

	if (instruction.command === 'conditionalStatement') { //Is conditional instruction
		if (!isTrue(instruction.condition, ctx)) {
			if (instruction.elseInstruction) {
				parsedInstruction = instruction.elseInstruction
			} else {
				return Q()
			}
		} else {
			parsedInstruction = instruction.instruction
		}
	} else {
		parsedInstruction = instruction
	}

	const _function = functionMappings[parsedInstruction.command]
	if (!_function) {
		throw new Error('No handling found for command ' + parsedInstruction.command)
	}
	return _function(parsedInstruction, ctx, es)
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
  const query = {
    _index: type + 's',
    _type: type,
    _id: id,
    joins: joins
  }

  return es.deep.get(query, ctx).then((getRes) => {
    //Since search instruction does not have children instructions, we do not need to clone the ctx passed to it as param. So just setting the property directly in ctx as it will not be shared in different execution flow
    return ctx.setImmutable(as, getRes)
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
      noAggs: true,
      size: (instruction.getFirst && 1) || 20
    }
    es.deep.search(queryToEs, ctx)
    .then((searchRes) => {
      if (_.isEmpty(searchRes.hits.hits) && instruction.createIfNeeded) {
  			const entity = createIfNeeded(ctx.es, type, where, ctx)
				searchRes.hits.hits.push(entity)
				searchRes.hits.total = 1
      }
    //debug('searching', type, searchRes.hits && searchRes.hits.hits.map((h) => h._id) || searchRes._id)
      return searchRes
    })
    .then((searchRes) => {
      //Since search instruction does not have children instructions, we do not need to clone the ctx passed to it as param. So just setting the property directly in ctx as it will not be shared in different execution flow
      if (!instruction.as) {
        if (instruction.getFirst) {
          instruction.as = type
        } else {
          instruction.as = type + 's'
        }
      }
      if (instruction.getFirst) {
        const firstHit = searchRes.hits.hits[0]
        ctx = ctx.setImmutable(instruction.as, firstHit)
      } else {
        ctx = ctx.setImmutable(instruction.as, searchRes)
      }
      def.resolve(ctx)
    })
    .catch((err) => {
      debug('error is executeSearch', err, 'query', JSON.stringify(queryToEs))
      def.reject(err)
    })
  })
  return def.promise
}

/**
 * @param {Object} es the elasticsearch client
 * @param {String} type the type of entity to be creatsts.e
 * @param {Object} entity which may be an object with _id/_type/_source or just the body for getting stored as _source
 * @param {Cache} ctx - optional 
 */
const createIfNeeded = (es, type, entity, ctx) => {
  let entityBody = entity._source || entity.fields || {}
  entityBody = _.merge(entityBody, entity) //Sometimes there may be data in top level keys above _source or fields
  entityBody = _.omit(entityBody, ['_id', '_type', '_version'])
  entityBody = _.omit(entityBody, (v, k) => _.isUndefined(v) || _.isNull(v))
  unflatten(entityBody)
  const sanitizedEntityBody = sanitizeEntityBody(es, type, entityBody)

	const bodyKey = JSON.stringify(sanitizedEntityBody) 
	const alreadyCachedDoc = ctx.get(bodyKey)
	if (alreadyCachedDoc) {
		return alreadyCachedDoc 
	}

	entity = {
    _index: type + 's',
    _type: type,
    _id: entity._id || crypto.randomBytes(20).toString('hex'),
		isUpdated: true,
    _source: sanitizedEntityBody
	}
	ctx.set(bodyKey, entity)
	ctx.setEntity(entity)
	return entity
}

const executeLink = (instruction, ctx, es) => {
  instruction = val(instruction, ctx)
  instruction.isOwn = true

  const e1 = val(instruction.e1, ctx)
  //ctx.setEntity(e1)
  ctx.set(instruction.e1, e1)
  const e1FieldToSet = e1._source && '_source' || 'fields'
  e1[e1FieldToSet] = sanitizeEntityBody(es, e1._type, e1._source || e1.fields)

  const e2 = val(instruction.e2, ctx)
  if (!e1 || !e2) {
    debug(JSON.stringify(instruction))
  }
  const e2FieldToSet = e2._source && '_source' || 'fields'
  e2[e2FieldToSet] = sanitizeEntityBody(es, e2._type, e2._source || e2.fields)
  //ctx.setEntity(e2)
  ctx.set(instruction.e2, e2)

  return es.deep.link(instruction, ctx)
}

const executeUnLink = (instruction, ctx, es) => {
  instruction = val(instruction, ctx)
  instruction.isOwn = true
  return es.deep.unlink(instruction, ctx)
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
      //Give the child instructions a new ctx environment to set properties in _immutable part of the ctx.data. assocPath makes a shallow clone of the same
      const newCtx = ctx.setImmutable(instruction.as, item)
      return executeDeep(instruction.childInstructions, newCtx, es)
      .catch((err) => {
        if (err.message === 'stopHere') {
          return
        }
        throw err
      })
    })
  }
}

const executeIndex = (instruction, ctx, es) => {
  const entity = val(instruction.entity, ctx)

  const type = instruction.type || entity._type
  if (!type) {
    throw new Error('type not specified for index operation', instruction)
  }
  return Q(createIfNeeded(es, type, entity, ctx))
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
    scroll: instruction.scrollDuration || '300s',
    body: {
      from: instruction.from || 0,
      size: instruction.batchSize || 100
    }
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

      _.set(esQuery, ['body','query'], query.query)
      scrolledSearchAndExecuteChildrenInstructions(es, esQuery, ctx, instruction)
      .then((res) => {
        deferred.resolve(res)
      })
      .catch((err) => {
        deferred.reject(err)
      })
    })
  } else {
    scrolledSearchAndExecuteChildrenInstructions(es, esQuery, ctx, instruction)
    .then((res) => {
      deferred.resolve(res)
    })
    .catch((err) => {
      deferred.reject(err)
    })
  }

  return deferred.promise 
  
}

const scrolledSearchAndExecuteChildrenInstructions = (es, searchQuery, ctx, instruction) => {
  let numTotalHits = 0
  let iterationsWithoutFlush = 0

  return es.search(searchQuery)
	.catch((err) => {
    debug('Scrolling: Exception in executing first search', err, 'for query', JSON.stringify(searchQuery))
		throw err
	})
  .then((res) => {
    if (!res || _.isEmpty(res.hits.hits)) {
      //debug('empty response', res)
      return
    }
    let soFar = 0
    return async.whilst(() => !_.isEmpty(res.hits.hits), () => {
      debug('iterating over index ' + searchQuery.index + ': got hits', (soFar += res.hits.hits.length) && soFar)//, res.hits.hits.map((h) => h._id))

      let priorFlushPromise
      if (instruction.flushEvery) {
        if (iterationsWithoutFlush === instruction.flushEvery - 1) {
          ctx.flush(true)
          iterationsWithoutFlush = 0  
        } else {
          iterationsWithoutFlush ++
        }
      }

      numTotalHits += res.hits.hits.length
      
      let promise = (instruction.from && (numTotalHits < instruction.from) && Q()) || asyncFunctions.each(res.hits.hits, instruction, ctx, es)

      return promise.then(() => {
        if (instruction.flushAtEnd) {
          ctx.flush(true)
        }
      })
      .then(() => {
        if (instruction.wait) {
          return Q.delay(instruction.wait)
        }
      })
      .then(() => {
        //debug('iterating over index: sending next query')
        return es.scroll({
          scrollId: res._scroll_id,
          scroll: instruction.scrollDuration || '60s'
        })
				.catch((err) => {
					debug('Scrolling: Exception in executing scrolled search', err, 'for query', JSON.stringify(searchQuery))
					throw err
				})
        .then((scrollRes) => {
          res.hits.hits = scrollRes.hits.hits
          res._scroll_id = scrollRes._scroll_id
          return res
        })
      })
    })
  })
}

//'display speaker, *speaker'
//>> speaker, {_id: 1, name: 'DalaiLama'}
const executeDisplay = (instruction, ctx, es) => {
	let args = instruction.args.map((arg) => val(arg, ctx)) 
	debug.apply(null, args)
	return Q()
}

const functionMappings = {  
	'get': executeGet,
	'search': executeSearch,
	'link': executeLink,
	'unlink': executeUnLink,
	'async': executeAsync,
	'unset': executeUnset,
	'addToSet': executeMemUpdate,
	'add': executeMemUpdate,
	'index': executeIndex,
	'boolExpression': isTrue,
	'iterateOverIndex': iterateOverIndex,
	'stopHere' : () => {throw new Error('stopHere')},
	'assignment': executeAssignment,
	'display': executeDisplay
}

module.exports = DslEngine

if (require.main === module) {
  const EpicSearch = require('../../index')
  const es = new EpicSearch(process.argv[2])

  const ctx = new Cache(es, {x: {a: 'true', b:[] }})

  //'roleFeatures.translationType is *audioChannel.translationType if *roleType is translator.'
    //'roleType is speaker if *x.c is empty. Else is translator'
 	//'If *x is one of r or g, search speaker where {_id: 1} as speaker'
	//es.dsl.execute(['y is 5 if *x.a is one of 28 or 3 or 4 or 32. Else is 3'], ctx)
	//es.dsl.execute(['If *x.a is one of 28 or 3 or 4 or 2, y is 33. Else y is 3'], ctx)
	es.dsl.execute(['if *x.a is true, v is 6. Else v is 4'], ctx)
	.then((res) => {
		debug('y is', res.get('v'))
	})
	.catch(debug)

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

  //const search = ['search first event where {_id: "AVeuJeQ9jGz7t7QfUg_M"}. Join from search. Create if not exists']//, 'search event where {_id: 1} as event2']
  /**return iterateOverIndex({
    as: 'event',
    type: 'event',
    scrollDuration: '10s',
    childInstructions: [(ctx) => debug(ctx.as))],
    size: 5
  }, ctx, es)
  .catch((e) => debug(JSON.stringify(e)))
  .then(() => debug('done'))**/
