ElasticGraph
=============

ElasticGraph extends ElasticSearch, to provide a Graph search and analytics, among other benefits like multi lingual storage, declarative data dependency management across related entities and performance benefits. It is fully open source and has been developed by Mindgrep in the Himalayas, between winter 2015 to summer 2017. The code based test cases still need to be fully covered. It has been functionally tested well at the Dalai Lama archive for which the project was originally initiated.


Installation
==============

```
npm install elasticgraph
```

Setup
=======

Download default config (https://github.com/awesomepankaj/elasitc-graph-config).

```
var elasticgraph = require('elasticgraph')
var es = new elasticgraph(config)
//These two lines replace your require('elasticsearch') and new elasticsearch.client(config) calls
```

From here on, you can use the elasticgraph 'es' client instance, as you would have used elasticsearch module in your code. Elasticgraph is first a wrapper around Elasticsearch module and, it provides some added features on top. For all elasticsearch module supported methods, it will simply delegate the calls to embedded elasticsearch module. If you are already using elasticsearch, you will see no change anywhere, whether in code or in es requests form/flow. Once you start using any elasticgraph specific features (mentioned below), then elasticgraph will come into play.

ElasticGraph methods
---------------------
These are then methods that you can use to perform operations on elasticgraph.

1. deep.get
2. deep.index
3. deep.link
4. deep.search
5. deep.update

### Funtional features

##### deep.get

This function is used for getting an object from database.

```
var elasticgraph = require('elasticgraph')
var es = new elasticgraph(config)

/**
 * @param {String} _type
 * @param {String} _id
 * @param {String} langs - Optional
 * @param {String} joins - Optional
 */

es.deep.get({
  _type: 'event',
  _id: 'AVeuJeQ9jGz7t7QfUg_M',
  joins: 'read'
})
.then((res) => {
  console.log(res)
})
.catch((error) => {
  console.error(error)
})

```
##### deep.index

This function is used for creating entity in database.

```
var elasticgraph = require('elasticgraph')
var es = new elasticgraph(config)

/**
 * Indexes the entity in es. Also stores it in cache, if cache is passed, replacing any older version of same entity from the cache
 * @param {String} id (or id) - optional
 * @param {String} index - optional. Otherwise type + 's' is used as default index.
 * @param {String} type (or _type) - type of entity
 * @param {Object} body - the entity body
 * @return {Object} Object with Id and type
 */

es.deep.index(
  {
    "_type": "event",
    "context": "index",
    "lang": ["english"],
    "body": {
      "english": {
        "title": "Ghoomakad is going good."
      }
    }
  }
)
.catch((err) => {
  console.error(err)
})
.then((res) => {
  console.log(res)
})

```

##### deep.update

This function is used for updating entity in database.

```
var elasticgraph = require('elasticgraph')
var es = new elasticgraph(config)

/**
 *@param {[Object]} entities - Optional. For multiple entities to updated together.
 Otherwise use _id and _type for single entity
 *@param {String} _id - Optional. If updating single entity only, then give its _id and type
 *@param {String} _type - Optional. If updating single entity only, then give its _id and type
 *@param {Boolean} isOwn - In case creating or removing a relation, specify whether the relations are direct relations or derived ones
 *@param {Boolean} dontHandleLinking - whether to call link/unlink in case any updated field is a relationship
 it is own or inferred relation from unionIn
 *@param {Object} update - the instructions to update as per js-object-updater npm
 *@return {Object} with status 201, _id and _type
*/

es.deep.update(
  {
    "_type": "event",
    "joins": "read",
    "lang": ["english"],
    "update": {set: {english: {title: 'Finding Common Ground'}}}
  }
)
.catch((err) => {
  console.error(err)
})
.then((res) => {
  console.log(res)
})

```

##### deep.search

This function is used for searching data in database.

```
var elasticgraph = require('elasticgraph')
var es = new elasticgraph(config)

/**
 * Caching optimazations:
 * - Ensure that if the search response exists in cache, that same cached response is returned.
 * - If not, it must get set in the cache and then returned.
 * - If any hits in response are in the cache, then replace that hit in es.hits.hits
 * with the document/entity stored in the cache.
 * - If the hit is not found in cache, and contains the _source (is full object),
 * then set that entity in the cache for future retrievals.
 *@param {String} _type type of object to fetch
 *@param {String} q - Optional - Text to query
 *@param {String} query - Optional Elasticsearch query as JSON object
 *@param {Array} langs - Optional. By default all supportedLanguages are used
 *@param {String} joins joins to do for given type. Can also pass an Object
 *@param {Array} fields fields to fetch for selected entity
 *@param {Integer} from
 *@param {Integer} size
 *@param {Boolean} suggest whether this is a suggest query or not
 *@param {Boolean} noAggs - by default aggs are returned with search based on aggregation.toml file. Disable this by setting this param to true
 *@param {Array} filters must clauses in elasticsearch format
 *@return {Object} results in elasticsearch format. If joins are specified then the _source key of matched results is replaced by "fields" key
 */

es.deep.search({
  _type: 'event',
  langs: ['english'],
  joins: 'search',
  query: {"query":{"bool":{"must":[{"match_phrase":{"english.description":"ghoomakad"}}]}}}
}, cache)
.catch((err) => {
  console.error(err)
})
.then(function(res) {
  console.log(res)
})

```

##### deep.link

This function is used for linking two entities/objects.

```
var elasticgraph = require('elasticgraph')
var es = new elasticgraph(config)

/**
 * Link entities of a particular type, along a particular relationship,
 * with entities of possibly different types. The linking goes through provided:
 * a. Schema.e1.e1Relation definition exists
 * b. All e2 types are allowed as per schema.e1.e1Relation definition
 * c. If the reverse relationship name is specified in schema.e1.e1Relation,
 *    and is specified in e2 schema,
 *    ande it carries e1Relation as the reverse name under which e1Type is valid destination
 *
 * If the operation is not allowed for any combination of e1+e2, then an exception is thrown
 * immediately without applying any changes anywhere.

 * @param {Object} e1
 * @param {String} e1ToE2Relation
 * @param {Object} e2 single entity with _type and _id fields
 * @param {Array<Object>} e2Entities array of objects with _type and _id fields
 * @param {Boolean} isOwn - Whether this link is created by a direct api call to deep.link or from within deep.update? In earlier case isOwn is true. Latter case it must be falsy.
 * @param {Boolean} relationPropertyIsSet - If true, it is assumed that e2Entities or e2, is already set in e1ToE2Relation. So deep.update is   not called to set the relationship property }
 * @return {Object} with e1ToE2Relation, e1 and e2 / e2entities
 *
 */

es.deep.link({
  e2: {
    _type: 'event',
    _id: '672'
  },
  e1: {
    _type: 'session',
    _id: 'ba779f2e35be5d456832e97cf8eeb8d39cbef933'
  },
  e1ToE2Relation: 'event'
})
.then((res) {
  console.log(res)
})
.catch((err) => {
  console.error(err)
})

```
