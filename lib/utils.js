'use strict'
const _= require('lodash')

/**
 * Finds keys with . separated strings in the document tree, and unflattens the document at those paths.
 * Note: Mutates the doc object itself
 */
const unflatten = (doc) => {

  _.keys(doc).forEach((key) => {

    const value = doc[key]
    const path = key.split('\.')

    if (path.length > 1) {
      let innerDoc = doc
      path.forEach((edge, index) => {
        if (!innerDoc[edge]) {
          if (index < path.length - 1) { //Non-leaf edge
            innerDoc[edge] = {}
          } else { //Leaf edge
            innerDoc[edge] = value
            delete doc[key] //The flat, dot separated key is not needed anymore
          }
        }
        innerDoc = innerDoc[edge]
      })
    }

    if (_.isObject(value)) {
      unflatten(value)
    } else if (_.isArray(value)) {
      value.forEach((arrayItem) => {
        if (_.isObject(arrayItem)) {
          unflatten(arrayItem)
        }
      })
    }

  })

  return doc //Return the original doc
}

module.exports.unflatten = unflatten

if (require.main === module) {
  const doc = {
    'a.c.d': 4,
    'v': {
      'g.h': {
        'm.r': 3
      }
    },
    'e.f': [{'w.e': 2}]
  }
  unflatten(doc)
  console.log(JSON.stringify(doc))
}
