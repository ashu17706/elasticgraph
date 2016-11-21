const _= require('lodash')
const sanitize = require('../deep/sanitizeEsResponse')

/**
 *@param es
 *@param type entity type
 *@param body entity body 
 */
const sanitizeBasedOnSchema = (es, type, body) => {
  const langs = es.config.common.supportedLanguages

  const entitySchema = es.config.schema[type]

  return _.transform(body, (soFar, fieldValue, field) => {
    const fieldSchema = entitySchema[field] 

    if (fieldSchema) {

      if (fieldSchema.isRelationship) {
        if (_.isArray(fieldSchema.type)) {

          if (!_.isArray(fieldValue)) {
            if (_.isArray(fieldValue._id)) { 
              soFar[field] = sanitize.sanitizeEntity(es, fieldSchema.to, fieldValue) 
            } else {
              soFar[field] = [fieldValue]
            }
          } else {
            //mean already is array of entities
            soFar[field] = soFar[field] && soFar[field].map((entity) => {
              const relatedEntityBody = sanitizeBasedOnSchema(es, fieldSchema.to, entity.fields || entity._source)
              return {_id: entity._id, fields: relatedEntityBody}
            })
          }
        } else {
          soFar[field] = _.isArray(fieldValue) && fieldValue[0] || fieldValue
          const fields = fieldValue.fields || fieldValue._source

          if (fields) {
            
            const relatedEntityBody = sanitizeBasedOnSchema(es, fieldSchema.to, fields)
            soFar[field] = {_id: soFar[field]._id, fields: relatedEntityBody}
          } else {

            soFar[field] = fieldValue
          }
        }
      } else {
        //is simple field
        if (_.isArray(fieldSchema.type)) {
          soFar[field] = _.isArray(fieldValue) && fieldValue || [fieldValue]
        } else {
          soFar[field] = _.isArray(fieldValue) && fieldValue[0] || fieldValue
        }
      }
    } else { //should be language or unknown field
      if (_.includes(langs, field)) {
        soFar[field] = sanitizeBasedOnSchema(es, type, fieldValue) 
      } else {
        soFar[field] = fieldValue
      }
    }

  }, {})
}

module.exports = sanitizeBasedOnSchema
