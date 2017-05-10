'use strict'

const Q = require('q')
const async = require('async-q')
const _ = require('lodash')
const debug = require('debug')('elasticgraph:deep/graph/inboundUpdater')
const utils = require('../utils')
const traverser = require('./traverser')

/**
 * Updates the leftNode and the nodes linked to it (further down upto traversal depth) with relation to rightNode, based on updateCallback 
 * @param {Object} cache
 * @param {Object} leftNode
 * @param {Array | String} path => [(relationName, nodeId)+] Edge path from left node to right node 
 * @param {Object} rightNode
 * @param {Function} updateCallback - Takes params (cache, leftNode, edgePathFromLeftToRight, rightNode)
 * @param {Number} traversalDepth - the depth to go into. By default config/common/graphTraversalDepth or 4
 *
 */
const execute = (cache, leftNode, path, rightNode, updateCallback, traversalDepth) => {

  debug('update operation called for left node', JSON.stringify(leftNode), 'right node', JSON.stringify(rightNode), 'path', path)
  //debug('execute', leftNode, path, rightNode )
  return utils.getEntity(cache, leftNode._id, leftNode._type)
  .then((leftNode) => {

    //Execute update callback for leftNode and rightNode
    return updateCallback(cache, leftNode, path, rightNode)
    .then(() => {

      //Update its pre-existing graph
      traversalDepth = traversalDepth || cache.es.config.common.graphTraversalDepth || 2 
      
      //Execute update callback for the related nodes of leftNode and rightNode
      //Recursive callback to be given for traversal
      const updateFurtherLeft = (params) => {

        debug('updating further left from', leftNode._type, 'visited node', params.visitedNode._type, 'path from visited to node', utils.extractRelationWisePath(params.edgePathFromVisited), ' right Node', rightNode._type, 'visited node source', params.visitedNode._source) 

        return updateCallback(cache, params.visitedNode, params.edgePathFromVisited, rightNode)
      }
     
      return traverser.traverseFromNode(cache, leftNode, traversalDepth, path, updateFurtherLeft) 
    })
  })
}

module.exports.execute = execute 
