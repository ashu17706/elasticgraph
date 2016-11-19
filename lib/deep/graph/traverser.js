'use strict'

const Q = require('q')
const async = require('async-q')
const _ = require('lodash')
const debug = require('debug')('epicsearch:deep/graph/traverser')
const updater = require('js-object-updater')

const utils = require('../utils')

/**
 * Traverses the newly connected graph of leftNode through rightNode, based on a particular pathType in fields of leftNode
 * For every node found, applies the callback with following params Object. Returns when callback has been applied to each traversed node
 * {
 *  pathType: {String} //For which we are traversing the newly connected graph. Ex. unionIn, joinIn
 *  leftNode: {Object}, //in ES format with _source
 *  leftNodeFieldInfo: {Object}, //Info of field for which the pathType was traversed
 *  //edgePathToRightNode: [({relationName}, {node._id}),* //Sequence of relationName followed by id]
 *  rightGraphNode: {Object}, //in ES format with _source
 *  relationPathToRightGraphNode: [String]
 *  rightGraphNodeField: String
 * }
 * @param {Object} cache
 * @param {String} pathType either of unionFrom, copyFrom, joinFrom
 * @param {Object} leftNode The node whose field (of which is the fieldInfo) is to be udpated based on another field in rightNode (*if applicable)
 * @param {Array} edgePathToRightNode Path consisting of relationship, _id pairs, leading from leftNode to rightNode.
 * @param {Object} visitedNode the source of information from which left Node's field is to be updated (if applicable)
 *
 */
const traverse = (cache, pathType, leftNode, edgePathToRightNode, rightNode, callback) => {

  return utils.loadEntities(cache, leftNode, rightNode)
  .spread((leftNodeLoaded, rightNodeLoaded) => {
		if (!rightNodeLoaded) {
			debug('did not find right node', rightNode, cache.data)
		}
    //debug('traverseThroughRightNode: Left node', leftNode._type, 'path to right', edgePathToRightNode, 'right node', rightNode._type, 'path type', pathType)

    const leftNodeSchema = cache.es.config.schema[leftNode._type]

    //For every field of the leftNode - relations and properties
    return async.each(_.keys(leftNodeSchema),
      (leftNodeFieldName) => {

        const leftNodeFieldInfo = leftNodeSchema[leftNodeFieldName]
        
        return exploreStartingFromLeftEndingAtRight(cache, pathType, leftNodeLoaded, leftNodeFieldName, edgePathToRightNode, rightNodeLoaded, callback)
        .then(() => {
          return exploreEndingAtLeftConcerningRight(cache, pathType, leftNodeLoaded, leftNodeFieldName, edgePathToRightNode, rightNodeLoaded, callback)
        })
        .then(() => {
          return Q.all([
            exploreStartingFromLeftToBeyondRight(cache, pathType, leftNodeFieldInfo, leftNodeFieldName, leftNodeLoaded, edgePathToRightNode, rightNodeLoaded, callback),
            exploreGoingThroughLeftAndRight(cache, pathType, leftNodeFieldInfo, leftNodeFieldName, leftNodeLoaded, edgePathToRightNode, rightNodeLoaded, callback)
          ])
        })
      }
    )
  })
}

const exploreStartingFromLeftEndingAtRight = (cache, pathType, leftNode, leftNodeFieldName, edgePathToRightNode, rightNode, callback) => {
  const leftNodeSchema = cache.es.config.schema[leftNode._type]
  const leftNodeFieldInfo = leftNodeSchema[leftNodeFieldName]
  const relationPathToRightNode = utils.extractRelationWisePath(edgePathToRightNode)

  let paths = _.get(leftNodeFieldInfo, [pathType, 'startingFromMe', 'index', leftNode._type, leftNodeFieldName, 'paths'])
  if (_.isEmpty(paths)) {
    return Q()
  }
  paths = paths.filter((path) => {
    //return utils.indexOf(path, relationPathToRightNode) > -1 && (path.length - 1 === relationPathToRightNode.length) 
    return _.isEqual(_.dropRight(path, 1), relationPathToRightNode)
  })

  return async.each(paths, (path) => {
    //debug('starting from', leftNode._type, 'ending at right node', rightNode._type, 'for field', _.last(path), 'and path type', pathType)
    return callback({
      cache: cache,
      pathType: pathType,
      leftNode: leftNode,
      leftNodeFieldInfo: leftNodeSchema[leftNodeFieldName],
      relationPathToRightGraphNode: relationPathToRightNode,
      edgePathToRightNode: edgePathToRightNode,
      rightGraphNode: rightNode,
      rightGraphNodeField: _.last(path)
    })
  })
}

const exploreStartingFromLeftToBeyondRight = (cache, pathType, leftNodeFieldInfo, leftNodeFieldName, leftNode, edgePathToRightNode, rightNode, callback) => {
  //debug('traverseStartingFromLeftNodePaths', leftNode._type, leftNodeFieldName, leftNodeFieldInfo[pathType])

  //Get relation wise path from edge path. Ex. sessions.speakers from sessions, 'session_id', speakers, 'speaker_id'
  const pathToRightNode = utils.extractRelationWisePath(edgePathToRightNode)

  //Which paths to fetch depdendent field information from?
  //Start with startingFromMe paths
  let pathsStartingFromLeftNode = _.get(leftNodeFieldInfo[pathType], ['startingFromMe', 'index', leftNode._type, leftNodeFieldName, 'paths'])

  if (pathsStartingFromLeftNode) {
    pathsStartingFromLeftNode = 
      pathsStartingFromLeftNode
      .filter((path) =>
        utils.indexOf(_.dropRight(path, 1), pathToRightNode) > -1 && (path.length - 1 > pathToRightNode.length) //drop last edge from path as it is name of a field/relationship in last entity of the path
      )
    if (!_.isEmpty(pathsStartingFromLeftNode)) {

      return async.each(pathsStartingFromLeftNode, (pathStartingFromLeftNode) => {
        
        return traverseFromNodeForPath(cache, pathType, pathStartingFromLeftNode, leftNode, leftNodeFieldName, callback) 
      })
    }
  }

  return Q()
}

// Applicable only if left and right node are immediately connected via a direct relationship. Ex. left == session, right == speaker. And event.speakers = +sessions.speakers. So for speakers leftNodeField of session leftNode, explore if there is a path ending at session.speakers
const exploreEndingAtLeftConcerningRight = (cache, pathType, leftNode, leftNodeField, edgePathToRightNode, rightNode, callback) => {

  const leftNodeFieldInfo = cache.es.config.schema[leftNode._type][leftNodeField]
  if (leftNodeFieldInfo.to !== rightNode._type) {
    return Q() //We want to deal only with relationships connecting leftNode to rightNode
  }
  //Now handle throughMe paths
  const endingAtMeContextInfo = _.get(leftNodeFieldInfo[pathType], ['endingAtMe', 'index'])
  if (_.isEmpty(endingAtMeContextInfo)) {
    return Q()
  }
  //debug('traverseThroughLeftNodePaths', pathType, leftNode._type, leftNodeFieldName, goingThroughContextInfo, leftNodeFieldInfo[pathType])
  
  const relationPathToRightNode = utils.extractRelationWisePath(edgePathToRightNode)
  //For every source entity type for paths in throughMe/index in leftNodeFieldInfo
  return async.each(_.keys(endingAtMeContextInfo), (sourceEt) => {

    const sourceFieldWisePaths = endingAtMeContextInfo[sourceEt]
    //For every field of that entity type
    return async.each(_.keys(sourceFieldWisePaths), (sourceField) => {

      const sourceFieldPaths = sourceFieldWisePaths[sourceField]['paths']
      if (_.isEmpty(sourceFieldPaths)) {
        return
      }

      return async.each(sourceFieldPaths, (relationPathEndingAtLeftNodeField) => {

        const relationPathEndingAtLeftNode = _.dropRight(relationPathEndingAtLeftNodeField, 1)
        const relationPathFromLeftToLeftMostNode = utils.reverseRelationPath(cache.es.config, sourceEt, relationPathEndingAtLeftNode).reversePath
        if (_.isEqual(relationPathFromLeftToLeftMostNode, relationPathToRightNode)) { //we dont want to go in  a cycle from right to left and left to right. so ignore. This case will be handled when link.js will call makeLink with left and right reversed
          return
        }

        //debug('getLeftMostNodes: path type', pathType, 'leftMostNode' , et, 'leftNode' , leftNode._type, 'leftNodeField', leftNodeFieldInfo.name, 'path from left most to left', pathFromLeftMostToLeftNode, 'path from leftmost to right', pathThroughLeftAndRight, 'path fromleft to left most node', relationPathFromLeftToLeftMostNode)

        return utils.getEntitiesAtRelationPath(cache, leftNode, relationPathFromLeftToLeftMostNode)
        .then((leftMostNodes) => {
          if (_.isEmpty(leftMostNodes.entities)) {
            return
          }
          return async.each(leftMostNodes.entities, (leftMostNode) => {
            const params = {
              cache: cache,
              pathType: pathType,
              leftNode: leftMostNode,
              leftNodeFieldInfo: cache.es.config.schema[sourceEt][sourceField],
              relationPathToRightGraphNode: relationPathEndingAtLeftNode,
              edgePathToRightNode: utils.reverseEdgePath(cache, leftNode, leftMostNodes.idToEdgePathMap[leftMostNode._id], leftMostNode),
              rightGraphNode: leftNode,
              rightGraphNodeField: leftNodeField 
            }
            return callback(params)
          })
        })
      })
    })
  })
}

const exploreGoingThroughLeftAndRight = (cache, pathType, leftNodeFieldInfo, leftNodeFieldName, leftNode, edgePathToRightNode, rightNode, callback) => {

  //Now handle throughMe paths
  const goingThroughContextInfo = _.get(leftNodeFieldInfo[pathType], ['throughMe', 'index'])
  if (_.isEmpty(goingThroughContextInfo)) {
    return Q()
  }
  //debug('traverseThroughLeftNodePaths', pathType, leftNode._type, leftNodeFieldName, goingThroughContextInfo, leftNodeFieldInfo[pathType])
  const pathToRightNode = utils.extractRelationWisePath(edgePathToRightNode)
  //For every source entity type for paths in throughMe/index in leftNodeFieldInfo
  return async.each(_.keys(goingThroughContextInfo), (et) => {
    const fieldWiseInfo = goingThroughContextInfo[et]
    //For every field of that entity type
    return async.each(_.keys(fieldWiseInfo), (fieldName) => {

      const fieldInfo = fieldWiseInfo[fieldName]
      if (!fieldInfo.paths) {
        return Q()
      }

      let sourceEntitySchema = cache.es.config.schema[et]
      const pathsToTraverse = fieldInfo.paths.filter((path) => {
          for (let i in path) {
            const edge = path[i]
            if (sourceEntitySchema[edge].to === leftNode._type) {
              path = _.drop(path, i + 1)
              path = _.dropRight(path, 1)

              return utils.startsWith(path, pathToRightNode) //drop last edge from path as it is name of a field/relationship in last entity of the path
            }

            sourceEntitySchema = cache.es.config.schema[sourceEntitySchema[edge].to]
          }
        }
      )
      if (!pathsToTraverse) {
        return Q()
      }

      return async.each(pathsToTraverse, (pathThroughLeftNode) => {

        //debug(pathType, leftNode, leftNodeFieldInfo, pathToRightNode, pathThroughLeftNode, rightNode._type)
        return getleftMostNodes(cache, pathType, leftNode, leftNodeFieldInfo, pathToRightNode, pathThroughLeftNode)
        .then((leftMostNodes) => {

          if (_.isEmpty(leftMostNodes)) {
            return
          }

          return async.each(leftMostNodes, (leftMostNode) => {
            return traverseFromNodeForPath(cache, pathType, pathThroughLeftNode, leftMostNode, fieldName, callback) 
          })
        })
      })
    })
  })
}

const traverseFromNodeForPath  = (cache, pathType, path, leftNode, leftNodeField, callback) => {
  //Get leaf entities at of that path when exploring from right node.
  const relationPathToRightMostNodes = _.dropRight(path, 1)
  return utils.getEntitiesAtRelationPath(cache, leftNode, relationPathToRightMostNodes)
  .then((rightMostNodes) => {
    //debug('rightMostnodes',  leftMostNode._type, relationPathTorightMostNodes, rightMostNodes)

    //The right node's field to udpate from
    //Can be a simple field or a relationship field. Doesn't matter

    return async.each(rightMostNodes.entities, (rightMostNode) => {
      const params = {
        cache: cache,
        pathType: pathType,
        leftNode: leftNode,
        leftNodeFieldInfo: cache.es.config.schema[leftNode._type][leftNodeField],
        relationPathToRightGraphNode: relationPathToRightMostNodes,
        edgePathToRightNode: rightMostNodes.idToEdgePathMap[rightMostNode._id],
        rightGraphNode: rightMostNode,
        rightGraphNodeField: _.last(path)
      }
      return callback(params)
    })
  })
}

const getleftMostNodes = (cache, pathType, leftNode, leftNodeFieldInfo, pathToRightNode, pathThroughLeftAndRight) => {
  const indexOfleftNode = utils.indexOf(pathThroughLeftAndRight, pathToRightNode)
  const pathFromLeftMostToLeftNode = _.slice(pathThroughLeftAndRight, 0, indexOfleftNode)
  const throughMeSourceEntityTypes = _.keys(_.get(leftNodeFieldInfo, [pathType, 'throughMe','index']))

  return async.each(throughMeSourceEntityTypes, (sourceEntityType) => {

    const relationPathFromLeftToLeftMostNode = utils.reverseRelationPath(cache.es.config, sourceEntityType, pathFromLeftMostToLeftNode).reversePath

    //debug('getLeftMostNodes: path type', pathType, 'leftMostNode' , et, 'leftNode' , leftNode._type, 'leftNodeField', leftNodeFieldInfo.name, 'path from left most to left', pathFromLeftMostToLeftNode, 'path from leftmost to right', pathThroughLeftAndRight, 'path fromleft to left most node', relationPathFromLeftToLeftMostNode)

    return utils.getEntitiesAtRelationPath(cache, leftNode, relationPathFromLeftToLeftMostNode)
    .then((response) => response.entities)
  })
  .then((result) => _(result).flatten().compact().value())
}

module.exports = traverse

if (require.main === module) {
  const EpicSearch = require('../../../index')
  const es = new EpicSearch(process.argv[2])
  const Cache = require('../../cache')
  const cache = new Cache(es)
  const execute = es.dsl.execute.bind(es.dsl)
  const ctx = {
    session: {_source: {event: {_id: 1, own: true}, speakers: [{_id: 1, own:true}]}, _id: 1, _type: 'session'},
    event: {_source: {sessions: [{_id: 1, own:true}]}, _id: 1, _type: 'event'},
    speaker: {_source: {primaryLanguages: [{_id: 1, own:true}], sessions: [{_id: 1, own:true}]}, _id: 1, _type: 'speaker'},
    hindi: {_source: {speakers: [{_id: 1, own:true}]}, _id: 1, _type: 'language'},
  }

  //return execute(['index *speaker', 'index *session', 'index *event', 'index *hindi'], ctx)
  //.then(() => {
    traverse(cache, 'unionFrom', {_id: 1, _type: 'session'}, ['speakers', 1], {_type: 'speaker', _id: 1}, (params) => debug(_.omit(params, 'cache')))
  
  //})
  //.catch(debug)


}
