'use strict'
const _ = require('lodash')
const Q = require('q')
const debug = require('debug')('epicsearch:dslEngine/assignment')

const isTrue = require('./booleanExpression')
const resolve = require('./resolve')

module.exports = (expression, ctx, es) => {
  let value
  const doMainAssignment = !expression.condition && true || isTrue(expression.condition, ctx)
  if (doMainAssignment) {
    value = resolve(expression.assignment, ctx)
  } else { //if condition not true
    if (expression.elseAssignment) {
      value = resolve(expression.elseAssignment, ctx)
    }
  }

  const assignee = resolve(expression.assignee, ctx)

  const updatePath = assignee.split('.')

  if (updatePath[0][0] === '*') {
    updatePath[0] = _.trimLeft(updatePath[0], '*')  
  }
  const fieldToUpdate = updatePath.length > 1 && _.last(updatePath)

  if (fieldToUpdate && expression.deepUpdate) { //Means it is an entity being updated and we wish to save it in ES
    const doc = ctx.get(_.dropRight(updatePath, 1))
    if (!doc) {
      throw new Error('doc not found at update path ' + updatePath + ' in ctx' + JSON.stringify(_.omit(ctx, 'es')))
    }

      
    if (!doc._type || !doc._id) {
      throw new Error('Failed to execute deep assignment ' + expression + ' Empty id or type in entity ' + JSON.stringify(doc))
    }

    if (ctx.es.config.schema[doc._type][fieldToUpdate].cardinality === 'many') {
      if (!_.isArray(value)) {
        value = [value]
      }
    }
    //debug(entity, fieldToUpdate)
    return es.deep.update({
      _id: doc._id,
      _type: doc._type,
      update: {
        set: {
          [fieldToUpdate]: value
        }
      }
    })
  } 
  //Else is only in memory update or a top level assignment like x = 3
  
  return Q(ctx.setImmutable(updatePath, value))
}
