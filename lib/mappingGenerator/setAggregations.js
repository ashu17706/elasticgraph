const debug = require('debug')('aggsMapping')
const _ = require('lodash')

const setAggregation = (entityAggs, et, entityMapping, configs) => {

  if (!_.isArray(entityAggs)) {
    debug(entityAggs, et)
  }

  let fieldVal = {
    store: false,
    index: 'not_analyzed'
  } 

  entityAggs.forEach((path) => {
    path = path.split('.')
    const entityProps = entityMapping.mappings[et].properties
    setMappingAtPath(entityProps, path, et, configs.schema[et], configs, 'raw', fieldVal)   
  })
  debug(JSON.stringify(entityMapping))
}

const setMappingAtPath = (props, path, et, entitySchema, configs, fieldKey, fieldVal) => {
  if (_.isEmpty(path)) {
    return
  }
  
  const fieldSchema = entitySchema[path[0]]
  if (!fieldSchema) {
    debug('No field schema found at ' + path + ' for entity ' + et)
  }

  if (!fieldSchema.isRelationship) {

    const field = path[0]

    if (fieldSchema.multiLingual) {
         
      fieldVal.type = fieldType(fieldSchema.type)

      configs.common.supportedLanguages.forEach((lang) => {

        if (!_.get(props, [lang, 'properties', field, 'fields'])) {

          _.set(props, [lang, 'properties', field], {
            type: 'string',
              fields: {
                [field]: {
                  type: fieldType(fieldSchema.type),
                  analyzer: 'standard'//language
                },
                [fieldKey]: fieldVal
              }
            }
          )
        } else {
          _.set(props, [lang, 'properties', field, 'fields', fieldKey], fieldVal) 
        }
      })
    } else {

      fieldVal.type = fieldType(fieldSchema.type)

      if (!_.get(props, [field, 'fields'])) {
        _.set(props, [field], {
          type: 'string',
            fields: {
              [field]: {
                type: fieldType(fieldSchema.type),
                analyzer: 'standard'//language
              },
              [fieldKey]: fieldVal
            }
          }
        )
      } else {
        _.set(props, [field, 'fields', field ], fieldVal)   
      }
    }
    return
  }

  const type = fieldSchema.to

  if (!_.get(props, [path[0], 'properties', 'fields', 'properties'])) {
  
    
    _.set(props, [path[0], 'properties', 'fields', 'properties'], {})
    props[path[0]].type = fieldType(type)
  }


  setMappingAtPath(props[path[0]].properties.fields.properties, _.drop(path), type, configs.schema[type], configs, fieldKey, fieldVal)
}

const fieldType = (type) => {
  if (type === String || (_.isArray(type) && type[0] === String)) {
    return 'string'
  } else if (type === Date || type == 'date') {
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

module.exports.setMappingAtPath = setMappingAtPath
module.exports.setAggregation = setAggregation
