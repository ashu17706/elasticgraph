const debug = require('debug')('esMappingGenerator')
const _ = require('lodash')
const async = require('async-q')
const ElasticGraph = require('../../index')
const es = new ElasticGraph(process.argv[2])
const configs = es.config
const aggs = require('./setAggregations')


module.exports = function(entityType) {

  const entitySchema = configs.schema[entityType]
  const entityLanguages = configs.common.supportedLanguages
  const mapping = initialMapping(entityType)
  const entityProperties = mapping.mappings[entityType].properties

  const fields = _.keys(entitySchema)

  _.each(fields, function(field) {

    const type = entitySchema[field].type

    if (entitySchema[field].multiLingual && !entitySchema[field].isRelationship) {

      _.forEach(entityLanguages, function(language) {

        if (entitySchema[field].autoSuggestion) {

          _.set(entityProperties, [language ,'properties', field] , {
            type: 'string',
            fields: {
              [field]: {
                type: fieldType(type),
                analyzer: 'standard'//language
              },
              suggest: {
                type: fieldType(type),
                store: false,
                analyzer: 'autocomplete',
                search_analyzer: 'standard'
              }
            }
          })
        } else {

          _.set(entityProperties, [language, 'properties', field], {
            type: fieldType(type),
            analyzer: 'standard'//language
          })

        }

      })

    } else if (entitySchema[field].autoSuggestion && !entitySchema[field].isRelationship) {
      
      _.set(entityProperties, [field], {
        type: 'string',
        fields: {
          [field]: {
            type: fieldType(type),
            analyzer: 'standard'//'english'
          },
          suggest: {
            type: fieldType(type),
            store: false,
            analyzer: 'autocomplete',
            search_analyzer: 'standard'
          }
        }
      })
    } else if (_.isArray(type) && _.isPlainObject(type[0])) {

      entityProperties[field] = {
        dynamic: true,
        //type: 'Object', If specified, throws error in es 2.1. 
        properties: {}
      }

      const nestedProperties = entityProperties[field].properties

      _.forEach(_.keys(entitySchema[field].type[0]), function(nestedField) {

        nestedProperties[nestedField] = {
          type: fieldType(entitySchema[field].type[0][nestedField].type)
        }

      })

    } else if (entitySchema[field].isRelationship) {

      mapping.mappings[entityType].properties[field] = {
        type: 'object'
      }

      if (entitySchema[field].autoSuggestion) {

        let fieldVal = {
          type: "string",
          store: false,
          analyzer: "autocomplete",
          search_analyzer: "standard"
        }

        let suggestionPath = entitySchema[field].suggestionPath.split('.')

        suggestionPath.unshift(field)

        aggs.setMappingAtPath(mapping.mappings[entityType].properties, suggestionPath, entityType, entitySchema, configs, 'suggest', fieldVal)
      }
    } else {
      mapping.mappings[entityType].properties[field] = {
        type: fieldType(type)
      }
    }

  })

  debug(entityType, JSON.stringify(mapping))

  return mapping
}


function fieldType(type) {

  if (type === String || _.isArray(type) && type[0] === String) {
    return 'string'
  } else if (type === Date || type === 'date') {
    return 'date'
  } else if (type === Boolean) {
    return 'boolean'
  } else if (type == Number) {
    return 'float'
  } else if (type === Object) {
    return 'object'
  } else {
    return 'object'
  }
}


function langMapping(mapping, entityType, entityLanguages) {

  debug(mapping, entityLanguages)
  if (!mapping.mappings[entityType].properties[entityLanguages[0]]) {
    const langMapping = _.reduce(entityLanguages, function(result, language) {
      result[language] = {
        properties: {}
      }

      return result
    }, {})

    mapping.mappings[entityType].properties = langMapping

  }

  return mapping
}


function initialMapping(entityType) {

  const mapping = {
    mappings: {
      [entityType]: {
        dynamic: true,
        properties: {}
      }
    },
    settings: {
      analysis: {
        filter: {
          autocomplete_filter: {
            type: 'edge_ngram',
            min_gram: 1,
            max_gram: 20
          }
        },
        analyzer: {
          autocomplete: {
            type: 'custom',
            tokenizer: 'standard',
            filter: [
              'lowercase',
              'autocomplete_filter'
            ]
          }
        }
      }
    }
  }

  return mapping
}


if (require.main === module) {
  // run mapping generator on all entities mentions in configs.
  const toRecreateIndices = process.argv[4] && process.argv[4].split(',') || _.keys(configs.schema)
  const mappingsOfEntities = _.reduce(toRecreateIndices, function(result, entityType) {
    result[entityType] = module.exports(entityType)
    return result
  }, {})

  if (process.argv[3] === 'recreate' || process.argv[3] === 'delete') {
    debug('Deleting indices one by one')
    return async.eachSeries(toRecreateIndices, (et) => {
      return es.indices.delete({index: et + 's'})
        .then(() => {
          debug('Deleted index', et + 's')
        })
      .catch((err) => {
        if (err.status == 404) {
          debug(et + 's', 'index does not exist. ignoring.')
        } else {
          debug('Unknown error. Please recheck for index', et + 's', err)
        }
      })
    })
    .catch(debug)
    .then(() => {//. Creating again with new mapping
      if (process.argv[3] !== 'recreate') {
        return Q()
      }
      return async.eachSeries(toRecreateIndices, (et) => {
        if (es.config.aggregations[et]) {
          aggs.setAggregation(configs.aggregations[et], et, mappingsOfEntities[et], configs)
        }
        return es.indices.create({
          index: et + 's',
          body: mappingsOfEntities[et]
        })
        .then(() => {
          debug('Created index', et + 's')
        })
        .catch((err) => {
          debug('Error in creating index', et + 's', err, 'Mapping:', JSON.stringify(mappingsOfEntities[et]))
        })
      })
      .catch((err) => {
        debug('Error in creating indices', err)
      })
    })
    .then(() => {
      debug('Done')
    } )
  } else {
    debug(JSON.stringify(mappingsOfEntities), 'Simply printed the mapping')
  }
}
