'use strict'
const _ = require('lodash')
const toml = require('toml')
const async = require('async-q')
const fs = require('fs')
const debug = require('debug')('eps:configLoader')

const utils = require('../deep/utils')
const relationsFileGrammar = require('./relationshipFileGrammar')
const joinsFileGrammar = require('./joinsFileGrammar')

/**
 * Note: In the schema for an entity, every field will have different path types
 * going through it, starting from it or ending at it. This information is expected to be stored in the following format: //TODO write test case in mocha
 *{pathType}: 
		{
		"{throughMe|startingFromMe|endingAtMe}": {
				"{context}": {
						{sourceType}: {
              {sourceField}: {
						    "paths": [
								  [
										"b",
										"c",
										"cField"
								  ]
						    ],
						    {anyContextSpecificField}: {anyValue}
              }
            }
				}
		}
	}
 *
 * @param {String} configFolderPath To load and export config json from a config folder containing
 *      a. elasticsearch.toml for elasticsearch specific settings. To be passed to elasticsearch js client on its initialization
 *      b. collect.toml for query batching for performance enhancement
 *      c. schema/relationships.txt for relationship defs in the whole db
 *      d. schema/entities folder with {entity}.toml files containing simple (non-relation) field definitions
 *      e. schema/dependencies.toml for copying field and relation definitions into some entities from other entities
 *      f. schema/union.toml for field union dependencies between multiple entities 
 *      g. joins/* for join definitions across direct or distant relationships. joins/index is for index time joins. Rest joins are to be used by developer elsewhere in his/her code
 **/
module.exports = function(configFolderPath) {
  const config = {
    schema: {},
    //common: {},
    //invertedJoins: {},
    //joins: {},
  }

  setJsonContentFromToml(config, 'elasticsearch', configFolderPath + '/elasticsearch.toml')
  setJsonContentFromToml(config, 'collect', configFolderPath + '/collect.toml')
  setJsonContentFromToml(config, 'common', configFolderPath + '/common.toml')

  setFieldSchema(config, configFolderPath + '/schema/entities')
  setRelationships(config, configFolderPath + '/schema/relationships.txt')
  handleDependencies(config, configFolderPath +'/schema/dependencies.toml')

  setUnions(config, configFolderPath + '/schema/union.toml')

  setAllJoins(config, configFolderPath + '/joins')

  setToAndThroughPaths(config)

  setAggregations(config, configFolderPath + '/schema/aggregation.toml')

  _.each(config.schema, (entitySchema, et) => {
    if (entitySchema.pseudo) {
      delete config.schema[et]
    }
  })

  return config
}

const setJsonContentFromToml = (config, key, pathToTomlFile) => {
  //Load the schema for entity
  const fileContent = fs.readFileSync(pathToTomlFile)
  try {
    config[key] = toml.parse(fileContent)
  } catch (e) {
    debug('Error in parsing toml file', pathToTomlFile)
  }
  //debug('loaded toml file into config', key, config[key])
}

const setFieldSchema = (config, schemaBasePath) => {
  const files = fs.readdirSync(schemaBasePath)
  files.forEach((fileName) => {
    const et = fileName.split('.')[0]
    setJsonContentFromToml(config.schema, et, [schemaBasePath, fileName].join('/'))

    //Now sanitize field config for String, Number, type classes
    _.each(config.schema[et], (fieldConfig, field) => {

      if (!_.isObject(fieldConfig)) {
        return
      }
      fieldConfig.type = sanitizedType(fieldConfig.type)
      //debug(et, field, fieldConfig.type)

      const fieldBasicType = config.schema[et][field].to

      fieldConfig.name = field
      if (fieldBasicType === String && _.isUndefined(fieldConfig.multiLingual)) {
        fieldConfig.multiLingual = true
      }
    })
  })
}

const sanitizedType = (inputType) => {
  const isListType = _.isArray(inputType)
  const basicType = (isListType && inputType[0]) || inputType
  //debug(inputType, basicType, isListType)
  switch (basicType) {
    case 'String': {return isListType && [String] || String}
    case 'Object': {return isListType && [Object] || Object}
    case 'Array': {return isListType && [Array] || Array}
    case 'Number': {return isListType && [Number] || Number}
    case 'Boolean': {return isListType && [Boolean] || Boolean}
    default: {return inputType}
  }
}

const setRelationships = (config, relationshipFilePath) => {

  const fileContent = fs.readFileSync(relationshipFilePath).toString()

  const relationships = relationsFileGrammar.parse(fileContent)

  relationships.forEach((relationship) => {
    handleRelationship(config, relationship)
  })
}

const handleRelationship = (config, relationship) => {
  //A relationship name (forward and backward) may be shared between multiple entity pairs
  relationship.entityConnections.forEach((pair) => {

    //debug('relationship', relationship)

    //Set A to B relationship info in A's schema
    _.set(config.schema, [pair.a, relationship.aToBName], {
      isRelationship: true,
      name: relationship.aToBName,
      type: pair.cardinalityB === 'many' ? [pair.b] : pair.b,
      to: pair.b,
      cardinality: pair.cardinalityB,
      inName: relationship.bToAName,
      inCardinality: pair.cardinalityA
    })

    //Set B to A relationship info in B's schema, if applicable
    if (!relationship.bToAName) {
      return
    }
    _.set(config.schema, [pair.b, relationship.bToAName], {
      isRelationship: true,
      name: relationship.bToAName,
      type: pair.cardinalityA === 'many' ? [pair.a] : pair.a,
      to: pair.a,
      cardinality: pair.cardinalityA,
      inName: relationship.aToBName,
      inCardinality: pair.cardinalityB
    })
  })
}

const handleDependencies = (config, dependencyConfigPath) => {
  let entityWiseDependencies = fs.readFileSync(dependencyConfigPath).toString()
  try {
    entityWiseDependencies = toml.parse(entityWiseDependencies)
  } catch (err) {
    debug('Error in parsing dependency file', err, err.stack)
    throw err
  }
  
  const dependentEntityTypes = _.keys(entityWiseDependencies)
  dependentEntityTypes.forEach((dependentEt) => {
    config.schema[dependentEt] = config.schema[dependentEt] || {}
    const dependencies = entityWiseDependencies[dependentEt]
    _.forEach(dependencies, (dependency, sourceEt) => handleDependency(config, dependentEt, sourceEt, dependency))
  })
  _.each(config.schema, (entityConfig, et) => {
    if (entityConfig.pseudo) {
      return
    }
    _.each(entityConfig, (fieldSchema, field) => {
      if (!fieldSchema.isRelationship) {
        return
      }
      if (config.schema[fieldSchema.to].pseudo) {
        delete entityConfig[field]
      }
    })
  })
}

const handleDependency = (config, dependentEt, sourceEt, dependency) => {

  //First copy all the schema of sourceEt into destEt, as it is
  config.schema[dependentEt] = _.merge(_.cloneDeep(config.schema[sourceEt]), config.schema[dependentEt])
  delete config.schema[dependentEt].pseudo

  _.each(config.schema[sourceEt], (sourceFieldSchema, sourceEtField) => {
		if (sourceEtField === 'pseudo') { //Pseudo field of abstract parent entity is to be ignored
			return
		}
    if (sourceFieldSchema.isRelationship) {
      pickSourceEtRelation(config, dependentEt, sourceEt, sourceEtField, sourceFieldSchema, dependency)

    } else {
      const replacementFieldName = _.get(dependency, ['fieldsToPick', sourceFieldSchema.name]) || sourceFieldSchema.name
      config.schema[dependentEt][replacementFieldName] = _.cloneDeep(sourceFieldSchema)
    } 
  })
  //debug('extended ' + dependentEt + ' schema with following fields of ' + sourceEt, _.keys(config.schema[sourceEt]), 'new schema', config.schema[dependentEt])
}

const pickSourceEtRelation = (config, dependentEt, sourceEt, sourceEtRelation, sourceFieldSchema, dependency) => {
  if (sourceFieldSchema.to === dependentEt) {
    return
  }
  const relatedEtToDependentEtRelation = _.get(dependency, ['relationNameReplacements', sourceFieldSchema.inName]) || sourceFieldSchema.inName

  if (!config.schema[sourceFieldSchema.to]) {
    debug('Entity schema not found', sourceFieldSchema.to)
    return
  }
  //Set the inName in the dependent entity schema's relationship definition. Rest remains same.
  config.schema[dependentEt][sourceEtRelation].inName = relatedEtToDependentEtRelation
  
  //Create the relationship def in the relatedEtSchema
  const relatedEt = sourceFieldSchema.to
  const relatedEtSchema = config.schema[relatedEt]
  const incomingRelationSchema = relatedEtSchema[relatedEtToDependentEtRelation] = _.cloneDeep(relatedEtSchema[sourceFieldSchema.inName])
  if (!incomingRelationSchema) {
    debug('did not find ' + sourceFieldSchema.inName + ' relation definition in ' + relatedEt  + ' schema for source entity ' + sourceEt + ' and source entity field ' + sourceEtRelation, sourceFieldSchema)
    return
  }
  incomingRelationSchema.name = relatedEtToDependentEtRelation
  incomingRelationSchema.to = dependentEt
  incomingRelationSchema.type = incomingRelationSchema.cardinality === 'many' && [dependentEt] || dependentEt
}

const setAllJoins = (config, joinsDirectoryPath) => {
  const files = fs.readdirSync(joinsDirectoryPath)
  files.forEach((fileName) => {
		if (fileName[0] === '.') {
			return
		}
    setJoins(config, [joinsDirectoryPath, fileName].join('/'))
  })
}

const setJoins = (config, joinConfigPath) => {

  	const fileContent = fs.readFileSync(joinConfigPath).toString()
    //The name of the file without the extension, will be the name of this join config
    let joinConfigName = _.last(joinConfigPath.split('/'))
    joinConfigName = joinConfigName.split('.')[0]

    //Initialize the config for storing join info from given file
    const joinConfig = {}
    _.set(config, ['joins', joinConfigName], joinConfig)

    //Initialize the config for storing inverted join info from given file
    const invertedJoinConfig = {}
    _.set(config, ['invertedJoins', joinConfigName], invertedJoinConfig)

    //Single file contains joins for multiple entities.
    //Iteratve over joins for each entity
		let joinInfo 
  	try {
    	joinInfo = joinsFileGrammar.parse(fileContent)
		} catch (err) {
			debug('Error in parsing joins file', joinConfigPath)
    	debug(err, err.stack)
			throw err
		}
    joinInfo.forEach((entityWiseJoin) => {

      _.each(entityWiseJoin, (joinsForEntity, entityType) => {

        //joinFrom relationships when pulling join data from 
        //connected source entities into entityType
        setJoinsForEntity(config.schema[entityType], joinConfig, entityType, joinsForEntity, joinConfigName)
        
        //corresponding joinIn paths when pushing from source entities to entityType 
        //This will be useful when the source entity is updated 
        //and we want to push the new field into this entity
        setInvertedJoinsForEntity(config, invertedJoinConfig, entityType, joinsForEntity)  

      })
    })
}

const setInvertedJoinsForEntity = (config, invertedJoinConfig, entityType, joins) => {

  //Iterate over each join definition for that entity
  //Here, a join is expected to be of the form {path: [], fields: []}
  joins.forEach((join) => {
    
    //Get the reversed join path from source entityType to this entityType
    const reversePathResponse = utils.reverseRelationPath(config, entityType, join.path)
    const etB = reversePathResponse.lastEntityTypeAtPath
    const pathBToA = reversePathResponse.reversePath

    //Now we will set the joinIn at the respective field of sourceEntityType. so that when it gets updated, 
    //its new data can be easily reflected here
    
    //FIrst, initialize joinConfig for B entity type if not initialized
    const etBJoinIns = invertedJoinConfig[etB] = invertedJoinConfig[etB] || {}

    //Store joinIns for the fields of B, to be copied to 'entityType' (A) node
    join.fields.forEach((fieldName) => {
      //Get (and initialize if needed), the nested object to store information for joins at this path
      const fieldConfig = _.get(etBJoinIns, fieldName) || [] //Where B is sourceEntityType now 
      if (_.isEmpty(fieldConfig)) {
        _.set(etBJoinIns, fieldName, fieldConfig)
      }
      fieldConfig.push({path: pathBToA, joinAtPath: join.path})
    })
  })
}

const setJoinsForEntity = (entitySchema, joinConfig, entityType, joins, joinConfigName) => {

  //Initialize joinConfig for this entity type if not initialized
  joinConfig[entityType] = joinConfig[entityType] || {}
  const selfConfig = joinConfig[entityType]

  //Iterate over each join definition for that entity
  //Here, a join is expected to be of the form {path: [], fields: []}
  joins.forEach((join) => {

    if (join.path) {
      //Get (and initialize if needed), the nested object to store information for joins at this path
      const configAtJoinPath = _.get(selfConfig, join.path) || {}
      if (_.isEmpty(configAtJoinPath)) {
        _.set(selfConfig, join.path, configAtJoinPath)
      }
      //Store the fields to be retrieved from the nodes at that path, as top level keys in configAtJoinPath
      const pathOfPaths = 'joinFrom.startingFromMe.' + joinConfigName + '.' + entityType + '.' + join.path[0] + '.paths'

      let joinFroms = _.get(entitySchema[join.path[0]], pathOfPaths)
      if (!joinFroms) {
        joinFroms = []
        _.set(entitySchema[join.path[0]], pathOfPaths, joinFroms)
      }
      join.fields.forEach((fieldName) => {
        let path = join.path.concat([fieldName])
        configAtJoinPath[fieldName] = 1
        joinFroms.push(path)
      })
    } else {
      //own fields to include
      join.fields.forEach((fieldName) => {
        selfConfig[fieldName] = 1
      })
    }
  })

  let fields = _(entitySchema).map((value, key) => {
    if (!value.isRelationship) {
      return key
    }
  }).compact().value()
  
  let existingValues = _.intersection(fields, _.keys(selfConfig))

  if (_.isEmpty(existingValues)) {
    _.reduce(fields, (soFar, field) => {
      soFar[field] = 1
      return soFar
    }, selfConfig)
  }
}

const setAggregations = (config, configPath) => {
  
  const fileContent = fs.readFileSync(configPath).toString()
  let aggregations

  try {
    aggregations = toml.parse(fileContent)
  } catch (err) {
    debug('Error in parsing schema/aggregations file', err) 
  }

  _.set(config, 'aggregations', aggregations)
}

const setUnions = (config, configPath) => {

  const fileContent = fs.readFileSync(configPath).toString()
  let unions
  try {
    unions = toml.parse(fileContent)
  } catch (err) {
    debug('Error in parsing schema/unions file', err, err.stack)
    throw err
  }
  _.keys(unions).forEach((etA) => {
    //Iterate over each entity for which unions are specified
    const unionsForEtA = unions[etA]
    _.keys(unionsForEtA).forEach((aFieldToUnionFromB) => { //field or relationship
      //Iterate over every field of that entity, for which union is specified
      let aToBPaths = unionsForEtA[aFieldToUnionFromB]//aFieldToUnionFromB can get union from multiple sources
      aToBPaths = aToBPaths.replace(/\+/g, '').split(' ')
      aToBPaths = aToBPaths.map((path) => path.split('.'))

      _.set(config.schema, [etA, aFieldToUnionFromB, 'unionFrom', 'startingFromMe', 'index', etA, aFieldToUnionFromB, 'paths'], aToBPaths)

      //Now iterate over every field union path and set the reverse path with unionIn
      //In respective end (B) nodes for every path
      aToBPaths.forEach((aToBPath) => {
        const reversePathResponse = utils.reverseRelationPath(config, etA, _.dropRight(aToBPath, 1)) //etB.{pathToA}

        const etB = reversePathResponse.lastEntityTypeAtPath
        const reversePath = reversePathResponse.reversePath

        reversePath.push(aFieldToUnionFromB) //Push aFieldToUnionFromB to end of the path

        const BSchema = config.schema[etB]
        const bFieldToUnionInA = _.last(aToBPath)
        const pathOfPaths = 'unionIn.startingFromMe.index.' + etB + '.' + bFieldToUnionInA + '.paths'

        const bFieldUnionInFromMe = _.get(BSchema[bFieldToUnionInA], pathOfPaths) || []
        //debug(etB + '\'s field to union in ' + etA + ' is ' + bFieldToUnionInA, etA + ' to ' + bFieldToUnionInA + '\'s path', aToBPath, 'reversePath', reversePath)
        if (_.isEmpty(bFieldUnionInFromMe)) {
          _.set(BSchema[bFieldToUnionInA], pathOfPaths, bFieldUnionInFromMe)
        }

        bFieldUnionInFromMe.push(reversePath) //Set this path in BSchema/bFieldToUnionInA
      })
    })
  })
}

const setToAndThroughPaths = (config) => {
  _.each(config.schema, (entitySchema, entityType) => {
    _.each(entitySchema, (fieldSchema, fieldName) => {
      config.common.pathTypes.forEach(pathType => {
        if (!fieldSchema[pathType]) {
          return
        }
        _.each(fieldSchema[pathType]['startingFromMe'], (contextInfo, context) => {//context can be = index | search | anythingElse
          setPaths(config.schema, entityType, fieldName, pathType, context)
        })
      })
    })
  })
}
/**
 * @param pathType {String} unionIn, unionFrom, joinFrom etc
 * @param context {String} index, search etc
 *
 */
const setPaths = (schema, sourceEntityType, sourceEntityField, pathType, context) => {

  let fromMePaths = _.get(schema[sourceEntityType][sourceEntityField], [pathType, 'startingFromMe', context, sourceEntityType, sourceEntityField, 'paths'])

  if (!fromMePaths) {
    return
  }

  //Examples for sourceEntityType event,
  //event.primaryLanguages = +session.speakers.primaryLanguages
  //event.speakers = +session.speakers
  //event.names = +speakers.name
  fromMePaths.forEach((path) => {

    let currentEntityType = sourceEntityType

    //Now for every edge of path, set throughMe and fromMe in the nextEntityType
    _.dropRight(path).forEach((edge, i) => { //Last edge of path is either a simple field or relationship field. So not looping over it

      const isLastEdge = (i === (path.length - 1) - 1)
      let newPathWay
      let nextEntityType = schema[currentEntityType][edge].to
      const nextEntityField = path[i + 1]//Either a normal field or relationship. Doesn't matter in this case

      if (isLastEdge) {
        newPathWay = [pathType, 'endingAtMe', context, sourceEntityType, sourceEntityField, 'paths']
      } else {
        newPathWay = [pathType, 'throughMe', context, sourceEntityType, sourceEntityField, 'paths']
      }

      let pathsInNextEntityType = _.get(schema[nextEntityType][nextEntityField], newPathWay) || []
      if (_.isEmpty(pathsInNextEntityType)) {
        _.set(schema[nextEntityType][nextEntityField], newPathWay, pathsInNextEntityType)
      }
      pathsInNextEntityType.push(path)

      currentEntityType = nextEntityType

    })
  })

}

if (require.main === module) {
  const conf = module.exports(process.argv[2])
  debug(JSON.stringify(conf))
}
