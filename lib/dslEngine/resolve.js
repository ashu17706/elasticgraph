'use strict'
const R = require('ramda')
const _ = require('lodash')
const debug = require('debug')('epicsearch:dslEngine/resolve')

module.exports = (o, executionContext) => {

  if (_.isArray(o)) {
    return _.transform(o, (result, element) => {
      result.push(module.exports(element))
    }, [])
  } else if (_.isObject(o)) {
    return _.transform(o, (result, val, key) => {
      key = module.exports(key, executionContext)
      result[key] = module.exports(val, executionContext)
    }, {})
  } else if (_.startsWith(o, '*')) { //It is a variable in executionContext
    const path = _.trimLeft(o, '*').split('.')
    return deepGet(executionContext.data, path) || deepGet(executionContext.immutable, path)
    
  } else {
    return o //Key is the value itself
  }
}

const deepGet = (data, path) => {
    let toReturn
    for (let i in path) {
      if (!data) {
        return
      }
      const edge = path[i]
      toReturn = data[edge] || _.get(data, ['fields', edge]) || _.get(data, ['_source', edge])
      data = toReturn
    }
    return toReturn
}

if (require.main === module) {
  console.log(module.exports(
    {'*x': 4},
    {x: 2}
  ))
}
