'use strict'
const debug = require('debug')('fieldsToFetch')
const _ = require('lodash')

/**
 * @param {Object} es - epicsearch instance
 * @param {Object} joinConfigOrPath - the join config object or its String path to load it from
 * @param {Array} langs - Optional. The language(s) to load fields from. If not specified, all the supported languages are loaded
 * @return {Array} '.' separated paths as per the joinConfig specified
 *
 */
const forEntities = (es, joinConfigPathOrConfig, langs) => {
  return _(_.keys(es.config.schema))
    .map((entityType) => forEntity(es, entityType, joinConfigPathOrConfig, langs))
    .flatten()
    .uniq()
    .value()
}

const forEntity = (es, entityType, joinConfigPathOrConfig, langs, dontResolve) => {
	if (!entityType) {
		throw new Error('Entity type not specified', joinConfigPathOrConfig, langs)
	}
  const configs = es.config
  const schema = configs.schema[entityType]

  const joinConfig = _.isString(joinConfigPathOrConfig) ? _.get(configs['joins'], [joinConfigPathOrConfig, entityType]) : joinConfigPathOrConfig

  const joinPaths = getJoinPaths(joinConfig, schema)
  if (dontResolve) {
    return joinPaths
  }

  return resolvePaths(configs, entityType, langs, joinPaths)
}

const getJoinPaths = (joinConfig, entitySchema) => {
  let noFieldsInJoin = true
  let joinPaths = _.transform(joinConfig, (result, value, key) => {
    if (_.isObject(value)) {
      getJoinPaths(value).forEach((subPath) => {
        if (!_.isArray(subPath)) {
          subPath = [subPath]
        }
        subPath.unshift(key)
        result.push(subPath)
      })
    } else {
      result.push(key)
      noFieldsInJoin = false
    }
  }, [])
  if (noFieldsInJoin) { //Include all the simple fields
    const simpleFields = _.transform(entitySchema, (simpleFields, fieldSchema, fieldName) => {
      if (!fieldSchema.isRelationship) {
        simpleFields.push(fieldName)
      }
    }, [])
    joinPaths = joinPaths.concat(simpleFields)
  }

  return joinPaths
}

/**
 * Makes language and relationship join aware path, from logical path. if logical path is sessions.speakers.person.name, the full path, which is language and join aware, is sessions.fields.speakers.fields.person.fields.{lang}.name
 *
 * @param {Object} config - the global config object in cache.es
 * @param {String} entityType
 * @param {Array} langs the languages to be used or single string
 * @param {Array} path sequence of relationships/properties without {language} If string, it is dot separated
 * @return {String} . separated path with language filled in, 'fields' filled in.
 */
const resolvePath = (config, entityType, langs, path) => {
  path = _.isString(path) ? path.split('.') : path

  //For every language, create the path and return them all
  langs = langs && _.flatten([langs]) || config.common.supportedLanguages
  return _(langs)
    .map((lang) => resolvePathForLang(config, entityType, lang, path))
    .flatten()
    .uniq()
    .value()
}
/**
 * maps every path to its resolved version with language and join awareneness
 */
const resolvePaths = (config, entityType, langs, paths) => {
  if (!paths) {
    return
  }
  return _(paths)
    .map((path) => resolvePath(config, entityType, langs, path))
    .flatten()
    .uniq()
    .value()
}

const resolvePathForLang = (config, entityType, lang, path) => {

  let entityConfig = config.schema[entityType]
  if (!entityConfig) {
    throw new Error('Error: fieldsToFetch.resolvePath: no entityConfig found for entity type ' + entityType)
  }
  const idPaths = []
  //debug(lang, path, entityType)
  const resolvedPath = _.transform(path, (result, key) => {
    const fieldSchema = entityConfig[key]
    if (!fieldSchema) {
      throw new Error('Error: no fieldSchema found for ' + key + ' in entityType ' + entityType)
    }
    if (fieldSchema.isRelationship) {
      result.push(key)
      idPaths.push(result.concat(['_id']).join('.'))
      if (path.length > 1) {//If we have to go further inside the entity, then suffix with 'fields', else leave relationship name as it is
        result.push('fields') //for reading elasticsearch response which has fields
      } else { //If only name of relationship is given, then _id is the field to fetch
        result.push('_id')
      }
      //Assuming there is only one entity in the relationship. Or, even if there
      //are multiple entities, the remaining path from this key is common to all
      entityConfig = fieldSchema.joins || config.schema[fieldSchema.to]
    } else {
      if (fieldSchema.multiLingual) {
        result.push(lang)
        result.push(key)
      } else {
        result.push(key)
      }
    }
  }, []).join('.')

  idPaths.push(resolvedPath)
  //debug(entityType, idPaths)
  return idPaths
}
/**
 * @param {Array} field Can be . separated String or array of fields
 * @return {String} The path without language or 'field' or '_source' keywords
 *
 */
const logicalPath = (fullPath, lang) => {
  fullPath = _.isString(fullPath) && fullPath.split('.') || fullPath
  return _(fullPath).without(lang, 'fields').value().join('.')
}

module.exports = {
  forEntities: forEntities,
  forEntity: forEntity,
  resolvePath: resolvePath,
  resolvePaths: resolvePaths,
  logicalPath: logicalPath,
}

if (require.main === module) {
  console.log(resolvePath('language', 'name', 'english'))
  console.log(resolvePath('speaker', 'person.name', 'english'))
  console.log(pathsOfTree({a: {b: {c: 3, d: 4}, f: 2}, g: 1}))
}
