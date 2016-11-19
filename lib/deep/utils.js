'use strict'
const debug = require('debug')('eps:deep/utils')
const updater = require('js-object-updater')
const async = require('async-q')
const Q = require('q')
const _ = require('lodash')

const relationships = (cache, entityType) => {
  return _.pick(
    cache.es.config.schema[entityType],
    (fieldConfig) => {
      return fieldConfig.isRelationship 
    }
  )
}

/**
 * @param {Array} edgePath - consisting of relationName followed by nodeIds. A relation will not exist by itself without _id of a node following it.
 * @return {Array} the path of just relations (without node ids)
 */
const extractRelationWisePath = (edgePath) => {
  const isEvenNumberEntry = (item, i) => {
    return i % 2 === 0
  }
  return _.filter(edgePath, isEvenNumberEntry)
}

const getEntity = (cache, eId, type) => {
  var key = eId + type
  if (!type || !eId) {
    throw new Error('Id or type missing in getEntity: id ' + eId + ' type ' + type)
  }
  let existingEntity = cache.get(key)
  if (existingEntity) {
    return Q(existingEntity)
  } else {
    return cache.es.get.collect({
      index: type + 's',
      id: eId,
      type: type
    })
    .then((entity) => {
      if (!entity.found) {
				return
        //throw new Error('Entity not found. Type and id: ' + type + ' & ' +  eId)
      } else {
        //Avoid race condition so check in cache before setting
        existingEntity = cache.get(key)

        if (!existingEntity) {
          cache.setEntity(entity)
          //if (entity._type === 'session')
          //  debug('found entity in cache after es hit', entity)
          return entity

        } else {
          //if (existingEntity._type === 'session')
          //  debug('found entity in cache after es hit', existingEntity)
          return cache.get(key)
        }
      }
    })
  }
}

const loadEntity = (cache, entity) => {

  return getEntity(cache, entity._id, entity._type)
  .then((loadedEntity) => {
    _.merge(entity._source || entity.fields || (entity.fields = {}), loadedEntity._source || loadedEntity.fields)
    entity.version = loadedEntity.version || entity.version
    entity.isUpdated = loadedEntity.isUpdated || entity.isUpdated
    return entity
  })
}

const loadEntities = (cache, ...entities) => {
  return async.each(entities, (entity) => {
    return loadEntity(cache, entity)
  })
}

/**
 *
 * @param {Object} cache
 * @param {Object} sourceEntity
 * @param {Array or String} relationPath - composed of String seqyence of relations or . separated relation path. If empty or undefined, the sourceEntity itself is returned in response entities
 * @param {[String]} pathToPrepend - Optional. If provided, response.ifToEdgePathMap.{entity._id} will point to paths that are prepended by pathToPrepend.
 * @param {Object} idToEdgePathMap - Optional. If given, is used to populate id to edge path mappings for fetchd entities
 * @return {Object} - 
      {
        entities: {[Object]} //list of leaf entities of the tree governed by the path from sourceEntity>, 
        idToEdgePathMap: {Object} //<map of id of entities to edge wise path from sourceEntity to each entity, prepended with pathToPrepend
      }
 */
const getEntitiesAtRelationPath = (cache, sourceEntity, relationPath, pathToPrepend, idToEdgePathMap) => {

  idToEdgePathMap = idToEdgePathMap || {}

  if (_.isEmpty(relationPath)) {
    idToEdgePathMap[sourceEntity._id] = pathToPrepend
    return Q({entities: [sourceEntity], idToEdgePathMap: idToEdgePathMap})
  }

  if (_.isString(relationPath)) {
    relationPath = relationPath.split('.')
  }


  const firstRelation = _.first(relationPath)
  return getEntitiesInRelation(cache, sourceEntity, firstRelation)
  .then((relationEntities) => {


    let isNotArray = cache.es.config.schema[sourceEntity._type][firstRelation].cardinality === 'one'

    if (!relationEntities) {
      return isNotArray && Q({entities: undefined}) || Q({entities: []})
    }
    //Convert to array for iteration
    relationEntities = isNotArray && [relationEntities] || relationEntities
    //debug(relationEntities && 'found relationEntities', sourceEntity._type, firstRelation, isNotArray, relationEntities)
    return async.map(relationEntities, (relationEntity) => {
      const edgePathSoFar = (pathToPrepend || []).concat([firstRelation, relationEntity._id])
      if (relationPath.length > 1) {
        return getEntitiesAtRelationPath(cache, relationEntity, _.drop(relationPath, 1), edgePathSoFar, idToEdgePathMap)
      } else {
        //relatedEntity.edgePathFromSource = edgePathSoFar
        idToEdgePathMap[relationEntity._id] = edgePathSoFar
        return {entities: relationEntity}
      }
    })
    .then((result) => {
      const entitiesAtPath = _(result).map((r) => r.entities).flatten().uniq('_id').compact().value()
      return {
        entities: entitiesAtPath,
        idToEdgePathMap: idToEdgePathMap
      }
    })
  })
}

/**
 * @param {Object} cache
 * @param {String} etA - the type of starting entity
 * @param {Array} pathToB - the relationship path leading from etA to etB
 * @return {Object} {
      reversePath: bToAPath,
      lastEntityTypeAtPath: etB
    }
 */
const reverseRelationPath = (config, etA, pathToB)  => {

  //map the path to B, where for every relation, return its reverse name
  let bToAPath = _.map(pathToB, (forwardRelation) => {

    const forwardRelationSchema = config.schema[etA][forwardRelation]

    if (!forwardRelationSchema) { //TODO write a helpful error message to user to fix schema

      throw new Error('No forward relationschema for A ' + etA + '. Relation is ' + forwardRelation + '. A\'s schema is ' + JSON.stringify(config.schema[etA]) + ' pathToB is ' + pathToB)
    }

    const reverseRelation = forwardRelationSchema.inName
    etA = forwardRelationSchema.to //Keep progressing etA with every relation forward
    return reverseRelation
  })

  //reverse the path with reversed relation names to make the path correct backwards from B to A
  bToAPath = bToAPath.reverse()

  return {
    reversePath: bToAPath,
    lastEntityTypeAtPath: etA
  }
}

/**
 * Whether any of the path in paths contains the given path
 * @param {[String]} paths - List of paths
 * @param {String} path - path to check
 *
 */
const containsPath = (paths, path) => {
  if (!paths) {
    return false
  }
  for (const p of paths) {
    if (p.length != path.length) {
      return false
    }
    for (const i in p) {
      if (!_.isEqual(p[i], path[i])) {
        break
      }
      if (i == (p.length - 1)) {
        return true
      }
    }
  }
  return false
}

const indexOf = (path, subPath) => {
  let pathIndex = 0
  let matched = false
  while (!matched) {
    for (let subPathIndex in subPath) {
      //If matched
      if (subPath[subPathIndex] == path[pathIndex]) {
        if (subPathIndex == subPath.length - 1) { //If whole subPath has matched, return
          return pathIndex - (subPath.length - 1)
        }
        pathIndex++

      } else { //If not matched
        if (path.length - 1 === pathIndex) {
          return -1
        }
        pathIndex++
        break
      }


    }
  }
}

const getEntitiesInRelation = (cache, sourceEntity, relation) => {
  let entitiesWithId = (sourceEntity._source || sourceEntity.fields)[relation]
  if (_.isEmpty(entitiesWithId)) {
    return Q()
  }
  const relationInfo = _.get(cache.es.config.schema, [sourceEntity._type, relation])

  if (!_.isArray(entitiesWithId)) {
    entitiesWithId = [entitiesWithId]
  }
  return async.map(entitiesWithId, (entityWithId) => {
    return getEntity(cache, entityWithId._id, relationInfo.to)
  })
  .then((entities) => {
    entities = _.compact(entities)
    if (relationInfo.cardinality === 'one') {
      return _.first(entities)
    } else {
      return entities
    }
  })
}

/**
 * @param {Object} cache
 * @param {Object} startNode
 * @param [String] edgePath - [(relation, nodeId)+]
 */
const getEntityAtEdgePath = (cache, startNode, edgePath) => {
  const relatedNodeType = cache.es.config.schema[startNode._type][edgePath[0]].to
  let lastNode
  return getEntity(cache, edgePath[1], relatedNodeType)
  .then((nextNode) => {
    lastNode = nextNode
    if (edgePath.length == 2) {
      return lastNode
    }
    return getEntityAtEdgePath(cache, nextNode, _.drop(edgePath, 2))
  })
  
}


/**
 * @param {Array} path - the path which is to be checked as super path of subPath
 * @parah {Array} subPath
 */
const startsWith = (path, subPath) => {
  let currentIndex = 0
  for (let relation of subPath) {
    if (path[currentIndex] != relation) {
      return false
    }
    ++currentIndex
  }
  return true
}

const reverseEdgePath = (cache, sourceEntity, edgePathToDest, destEntity) => {
  let currentType = sourceEntity._type
  const schema = cache.es.config.schema
  const pathWithReversedEdges = [sourceEntity._id]

  for (let index in edgePathToDest) {
    const key = edgePathToDest[index] 
    if (index % 2 === 0) {
      const relation = key
      const relationInfo = schema[currentType][relation]
      const relationReverseName = relationInfo.inName

      pathWithReversedEdges.push(relationReverseName)
      currentType = relationInfo.to

    } else if (index < edgePathToDest.length - 2) { //Push all ids except the last id which is that of the destEntity
      const id = key
      pathWithReversedEdges.push(id)
    }
  }
  return pathWithReversedEdges.reverse()
}

/**if (require.main === module) {
  const EpicSearch = require('../../index')
  const conf = process.argv[2]
  const es = new EpicSearch(conf)
  const Cache = require('../cache')
  const cache = new Cache(es)
  const ctx = {}
  es.dsl.execute('get event 1', ctx)
  .then((event) => {
    return getEntitiesAtPath(cache, ctx.event, 'sessions.video')
    .then(debug)
  })
  .catch(debug)

 debug(reverseEdgePath(cache, {_type: 'session', _id: '1'}, ['speakers', '3', 'events', '2'], {_type: 'event', _id: '2'}))
  es.dsl.execute('get session 1', ctx)
  .then(() => {
    return getEntitiesAtRelationPath(cache, ctx.session, 'event.speakers')
    .then((entities) => {
    })
  })
}**/

module.exports.relationships = relationships
module.exports.getEntity = getEntity
module.exports.loadEntity = loadEntity
module.exports.loadEntities = loadEntities
module.exports.getEntitiesAtRelationPath = getEntitiesAtRelationPath
module.exports.getEntityAtEdgePath = getEntityAtEdgePath
module.exports.containsPath = containsPath
module.exports.startsWith = startsWith
module.exports.reverseEdgePath = reverseEdgePath
module.exports.reverseRelationPath = reverseRelationPath
module.exports.indexOf = indexOf
module.exports.extractRelationWisePath = extractRelationWisePath
