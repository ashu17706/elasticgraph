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

const fixStrings = (entity, cache) => {

  const entityBody = entity.fields || entity._source
  const configs = cache.es.config
  //TODO Fix this bug where mergeDeep sometimes fudges up Strings into hash objects. Happens from joinCalculator
  configs.common.supportedLanguages.forEach((lang)=> {
    _.each(_.get(entityBody, lang) || {}, (v,k) => {
      if (_.isObject(v)) {
        _.set(entityBody, [lang, k], _.values(v).join(''))
        debug("fiexed", [lang, k],  _.get(entityBody, k))
      }
    })
  })
  const joinDocSchema = configs.schema[entity._type]
  _.each(entityBody || {}, (v,k) => {
    if (_.isObject(v) && !_.includes(configs.common.supportedLanguages, k) && joinDocSchema[k] && joinDocSchema[k].type === 'String') {
      _.set(entityBody, k, _.values(v).join(''))
        debug("fiexed", k,  _.get(entityBody, k))
    }
  })
  //End of fixing string values fudged up by mergeDeep
}

module.exports.unflatten = unflatten
module.exports.fixStrings = fixStrings

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
