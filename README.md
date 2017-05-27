## **ElasticGraph**

ElasticSearch Xtended.

[Soon to be fully documented and released as an npm and REST server]

ElasticSearch (ES) is an excellent search and analytics engine. It is designed to scale with big data and heavy load. You can read more about it [here](https://www.elastic.co). 

Using ElasticGraph one can configure and run ElasticSearch as a highly scalable relational datastore, optimized for storing and querying large graphs with billions of vertices and edges distributed across a multi-machine cluster. ElasticGraph can support thousands of concurrent users, and complex search and analytic graph queries. 

 Here are the features of ElasticGraph

* Relationship management

    * Linking and unlinking two entities with a relationship

* Deeper Search

    * Across relationships of your information Graph

    * You can empower queries like - "Find me friends of friends who live in Bangalore"

* Deeper analytics

    * Across relationships of your information Graph

    * Sample - "City wise breakup of friends of friends"

* Joins

    * Merging data from related entities in read operations

    * Upto multiple depths of relationships

* Dependency management between data of related entities (rows). 

    * Based on dependency behavior of your data model as configured by you

    * Sample - When two people marry, groom’s parents get a daughter in law, and the bride’s parents get a son-in-law. EG works to maintain a consistent data state as per the data model rules setup in the configuration files.

* Multi lingual storage and read operations

    * You can store, retrieve and search text fields in any languages

* Easy SQL

    * Write SQL scripts or queries, but in English.

    * Express and execute complex data operations and migrations

    * Write complex logic in very few lines

* Performance features

    * Query batching

        * Helps ease the ES cluster and the NodeJS process speaking to it.

        * Easily collect and execute, multiple queries from different places in your application logic, *as one bulk query to ES. *Saves N -1 hits for every N queries.

    * In memory caching

        * Check and store queries and entities in an in-memory cache. This cache is internally populated and used during execution of EG’s deep API.

        * Developers can use this feature via EG’s npm module, to keep alive and share a cache object as long as they want.

Graph is part of the name, because here we see every dataset as a Graph of different types of nodes (entities) connected through different relationships. You can read more about Graph databases [here](https://en.wikipedia.org/wiki/Graph_database). While this being said, EG does not strive to be a full functional Graph database. It is, so far, a Graph way of extending to ElasticSearch. It does not support transactions or guarantee ACID behavior. It is designed to give great performance for *write less and read/search/analyse more* scenarios, under heavy query load over big data.

## **Packaging**

ElasticGraph is available as a NodeJS module. A REST server is also available. Use it as it suits you.

### As a NodeJS module

In order to use it in your Node process, you will need to replace ElasticSearch client with ElasticGraph. This client wraps around the ElasticSearch client. All your current code using official ES client will continue to work as it is. EG client will give you more functionality on the top. EG provides a promise based API which extends default ES api.

const ElasticGraph = require(‘elasticgraph’)

const es = new ElasticGraph(‘path/to/config/folder’)

You will need to configure your data model and setup details in the EG configuration folder. 

## **Entity and types**

In ElasticGraph (EG) domain, there are entities (similar to rows in MySQL, or nodes in a Graph). Each entity has an id, type, simple fields like text, date etc.  and relationships (akin to foreign keys)

Each entity is stored in a separate ElasticSearch index by the name entity._type + ‘s’

For example. for type video, the ES index will be videos

The simple fields of an entity are defined in configFolder/schema/entities/{entityType}.toml in the following way

[title]                                                                             

type = 'String'                                                                     

multiLingual = true                                                                 

autoSuggestion = true                                                               

                                                                                    

[description]                                                                       

type = 'String'                                                                     

multiLingual = true                                                                 

                                                                                    

[startingDate]                                                                      

type = 'date'                                                                       

multiLingual = false

Corresponding document of an Event in ElasticSearch will look like

{
  "_index": "events",
  "_type": "event",
  "_id": "294464",
  "_version": 4,
  "found": true,
  "_source": {
    "startingDate": 489004200000, //dates are stored as long
    "tibetan": { //Multilingual fields are stored within an object, contained by the language as the key
      "description": "\nལ་དཱགས་མི་མང་ནས་ཇི་ལྟར་གསོལ་བ་འདེབས་པ་བཞིན་༧སྤྱི་ནོར་༧གོང་ས་སྐྱབས་མགོན་\n\nཆེན་པོ་མཆོག་ནས་ནང་ཆོས་ངོ་སྤྲོད་སྩལ་།"
    },
    "english": {
      "description": "His Holiness the Fourteenth Dalai Lama gives an introduction on basic Tibetan Buddhism in Ladakh.",
      "archiveNotes": "We don't know who the audio person was."
    }

  }
}

In order to be able to treat date fields as dates, numeric fields as numbers, and string fields as full-text or exact-value strings, ES needs to know what type of data each field contains. This information is contained in the [mapping](https://www.elastic.co/guide/en/elasticsearch/guide/current/mapping-intro.html).

The data model you set for EG generates the appropriate mappings for ES. EG can be used to automatically store mappings in your vanilla ES cluster. Or you can copy paste, edit the generated mappings as per your custom requirements, and set them in ES cluster yourself. 

In the event example, since its title is multilingual and has autosuggest enabled, the autosuggest mapping is generated for both English and Tibetan values of the same field. 

TODO

Autosuggest queries are internally done on {language}.*title.suggest*. Normal text search queries are internally done on {language}.*title*. 

The EG api gives you abstraction in search/autosuggest. A ‘langs’ parameter is accepted in the search/autosuggest API to specify the language to query, and the name of the field. It is done internally by EG’s autosuggest and search API. 

## **Relationships**

In ElasticGraph deep.link and deep.unlink are used to establish or remove relationships.

You must define the relationships of your data model in configFolder/schema/relationships.txt

It is compulsory to maintain relationship definition both ways, from Entity A to B, and B to A.

The format for specifying relationships in relationship file is

relationNameFromAToB <> relationNameFromBToA

  entityTypeA <> entityTypeB //One to one

relationNameFromAToB <> relationNameFromBToA

  [entityTypeA] <> entityTypeB //Many to one

relationNameFromAToB <> relationNameFromBToA

  entityTypeA <> [entityTypeB] //One to many

relationNameFromAToB <> relationNameFromBToA

  [entityTypeA] <> [entityTypeB] //many to many

As you can see, when an entity type is surrounded by square brackets [], it means cardinality of many

Some examples

speakers <> events

[event] <> [speaker]

sessions <> event

event <> [session]

Example link call

es.deep.link({

  e1: {

    _type: ‘event’,

    _id: ‘674

  },

            e2: {

    _type: session,

    _id: 44

  },

  e1ToE2Relation: ‘sessions’

})

## **Graph Search and Graph analytics**

Using denormalisation

Imagine you have a database composed of events, speakers and persons.

And, you wish to do the following two queries. 

* Search events by speakers.person.name

* Show breakup of search on events based on speakers.person.name (like on ecommerce sites)

If your tables have only the foreign keys, you will have to do multiple hits to implement such cross table queries. And they will be slow. Depending on your data size, this may take a long long time before the final query result is returned.

*With ElasticGraph you can achieve the same result with a single hit to the database. *

How does this work? 

By denormalizing (copying) the latest speaker.person.name information within the event object, *during index, update, link or unlink calls*. 

Settings configFolder/joins/index.txt

For example, here is how ‘event’ may look like.

~~~

[event]

  sessions{title, description}

  speakers.person{name}

~~~

Based on your configuration ElasticGraph works to automatigally maintain the denormalised storage of speaker and session data in the event entities.  

#### Maintenance of the denormalised graph state

*EG ensures that your search reflects the latest and greatest state of the information Graph in real time.*

Here are some scenarios in which the automatic denormalization will trigger in our example database.

* Whenever you update the name of a person, the events where he or she spoke, will also get updated with person’s new name.

* When you index (store) the event for first time in the database, and it contains speakers ids, the speaker’s name will also get copied inside the event entity as it gets stored/indexed.

* When the event is linked to a speaker, the speaker’s name will get copied inside the event entity

* When the event is unlinked from a speaker, the speaker’s id, name etc will get removed from the event entity

The Butterfly effect

Any update can potentially create a ripple update across entire Graph, for maintaining correct data state as per the denormalisation and data dependency rules.

Since this is handled internally by ElasticGraph, it saves the developer from the overhead of maintaining a consistent, denormalised graph state across all updates. Her code doesn’t need to save the updated field value at multiple places in the database- a big overhead, lots of confusing code, more bugs... Instead, she simply declares the behavior just once, in a human readable way. After that she leaves it to ElasticGraph to do all the internal bookkeeping to upkeep a correct denormalised graph state all the time.

In traditional SQL databases, denormalisation on a foreign key generates one new row for every foreign key joined. In ElasticSearch, we make use of the document storage and do the joins within one document. In comparison to SQL way of rows, the document way of ES saves storage space and helps in faster analytics also. Have a look at how the denormalized speakers relationship is stored within an ElasticGraph event document.

{
  "_index": "events",
  "_type": "event",
  "_id": "294464",
  "_version": 4,
  "found": true,
  "_source": {
       "speakers": [
      {
        "_id": "c6c35e3b21815a4209054505ac5e1680a954efdf",
        "own": true, //Since own: true, this speaker must have been directly linked to event, and not inferred indirectly by a union specification
        "fields": {
          "person": {
            "_id": "1",
            "_version": 1,
            "fields": {
              "english": {
                "name": "His Holiness the 14th Dalai Lama"
              },
              "tibetan": {
                "name": "ྋགོང་ས་སྐུ་ཕྲེང་བཅུ་བཞི་པ།" //Now, with a single query, A. You can search events by speakers.person.{language}.name now. OrB. You can show breakup of event search results by speakers.person.{language}.name, like on ecommerce sites., because the information is available (joined) within the indexed event documents.
              }
            }
          }
        }
      }
    ],}

## **Read time joins**

Left Outer Joins in SQL world

Settings folder: configFolder/joins

~~~

deep.get({_id:1, _type: ‘event’ , joins: ‘read’})

deep.search({_id:1, _type: ‘event’ , query: {"match": {“speakers.person.english.name”: “Dalai Lama”}}, joins: ‘search’})

~~~

For read time joins, you specify name of a join configuration file stored in configFolder/joins. You can specify different joins for same entity in different contexts like get, search etc. The joined response is returned in same structure as the denormalization join you saw just above. You can apply joins across any relation depth.

## **Multi Linguality**

Settings file: configFolder/common.toml. 

In that set, supportedLanguages = [‘english’ , ‘tibetan’, ‘thirdLanguage’]

If your data is in a single language or is language agnostic, then  supportedLanguages = []

The fields which are declared multilingual, are stored like this in the _source of the entities.

"english": {
                "name": "His Holiness the 14th Dalai Lama"
              },

 "tibetan": {
                "name": "ྋགོང་ས་སྐུ་ཕྲེང་བཅུ་བཞི་པ།"

  }

When creating, updating, searching or getting an entity, you have to specify the full path of every field, including its language. In search and get calls, you specify langs parameter, for the languages in which the data is to be fetched. By default data in all supported languages is fetched.

## **Automatic data dependencies in storage**

ElasticGraph gives you a very easy way to manage complex data dependencies in your information graph. As any update is made to any Entity in your Graph, ElasticGraph checks if any part of the remaining Graph should be updated by this change. If yes, it updates the entire affected Graph. 

For now EG supports two kinds of dependencies - Union from and Copy.

* **Union from**

Settings are in configFolder/schema/union.toml

Union from operation can be used to compute and store distinct values, whether relationships or data values, merged from field values of multiple related entities.

This is useful for one to many or many to many relationships. Please look at the following examples to understand.

========

[conference]

speakers = '+talks.speaker' #As soon as a talk is linked to a conferece, or an already linked talk gets linked to a speaker, the talk’s speaker is also linked to the conference as one of its speakers, if not already linked before. Vice versa happens if the talk is unlinked to its speaker, or the talk is removed from the conference

topics = '+talks.topics' #As soon as a talk is linked to an conference, or a topic is set to an already linked talk, the talk’s topic is also added to the conference as one of its topics, if not already there. Vice versa happens if the talk is unliked to the conference, or the topic is removed from the talk.

[‘person’]

grandChildren = +‘children.children’ #Whenever a person’s child gets a new child, the new child gets added to the person’s grandchildren

[‘folder’]

fileTypes = ‘+childFolders.fileTypes + childFiles.type’ #Calculate union of all file types existing in the entire folder tree (recursively). Anytime, any file gets added to any child folder in this tree, the type of that file gets unioned with the list of fileTypes of that child folder, and all its parent folders up in the hierarchy.

========

You can specify any rules as per the dependencies in your data model.

* **Copy**

Settings are in configFolder/schema/union.toml

Currently the copy functionality is achieved from within the union configuration.

This is effective for many to one or one to one relations. For ex.

========

[person]

child = "+wife.child +husband.child" #This will ensure copy of child between husband and wife, whenever child is added to any one of the person entities

[file]

permissions = "+folder.permissions" #Whenever a folder’s permissions are updated the underlying files’ permissions are updated automatically. You can still manually override them, without affecting the folder. But whenever the folder’s permissions are updated again, the file’s permissions will get overwritten.

## **Easy SQL**

English like SQL to get lot of data work done - fast and easy. Even non-programmers can easily learn to do complex work over big data using this.

One can use ESQL for working with EG entities or even pure ES indices.

Its main features are

* Search, get, create and update ES documents or EG entities.

* Loop over any ES indices or EG entities, to do bunch of computation and IO for each ES document or EG entity retrieved.

* Do big data scans, computation or migration at ease, at great pace with less resources.

* Much much shorter and sweeter compared to equivalent Javascript code.

* Fast performance and less load due to 

    * Internal caching

        * The cache is used like a temporary EG index. Hit to ES for each get/search query is done only once. After that each retrieved entity or document, and search result, is kept in the in memory store.

        * Further, the update operations are done in memory

        * You can get the cache flushed at will. All the in-memory-updated entities will be written to ES indices, and all cache data will be cleared.

    * Internal use of collect feature

        * Instead of sending N hits for N queries, sending all N queries together in a batch saves N - 1 HTTP hits. This causes gain in speed and system’s computational capability.

It supports

* Search, get, index, link, unlink.

* Creation of variables and assignment of values

* If/else operations

* Looping - Async each parallel

    * Useful for scanning over a search result or entire index and doing operations.

    * Loops can be nested within each other

* Mixing pure JS functions as instructions of the script when the script can not handle the complexity of logic

The grammar of dsl engine is in the source code of ElasticGraph npm. lib/dslEngine/grammar.pegjs

You are welcome to create the documentation and tutorial of ESQL. I am happy to help you get started. And grateful too!

## **Performance features**

There are two internal feature which stand behind the awesome performance of ElasticGraph - Collect and Cache.

### Collect

A typical program, during runtime, sends multiple queries to the database from different places. In case of using ES from NodeJS, each query entails an HTTP hit. Each such hit is an overhead on the system. Both to the Nodejs client and the ES cluster. 

This feature allows you to save this overhead to achieve greater system speed and performance. Using this you can easily collect multiple queries and send them together to ES *in a single HTTP hit*. You can collect multiple queries from any parts of the runtime environment. 

Sample settings in configFolder/collect.toml

[batchSizes]     

  msearch = 200    

  index = 200                                                  

  mget = 200                                                   

  get = 200                              

  search = 200                                                 

  bulk = 200                                                   

[timeouts]    #in milliseconds

  index = 30                                                   

  get = 30                                                     

  bulk = 30    

  mget = 30                                                    

  msearch = 30                                                 

  search = 30 

*Each type of query is collected in a batch till any one of the batchSize threshold or the timeout threshold is reached.*

You can use this feature by adding .collect to your method calls using the official ES Nodejs client. 

es.{method}.collect({params})

The supported es methods are get, mget, search, msearch, bulk and index.

For ex. es.get.collect({_id:..,_type:..}).then()

*The* *deep functions and esql scripts of EG internally use this feature.* This feature is available as part of the npm module. TODO add this to REST server

### Cache

In the deep EG operations, a cache is used like a temporary EG index in memory. Hit to ES for each get/search query is done only once. After that each retrieved entity or document, and search result, is kept in the in memory store. Further, the graph update operations are also done in memory. Once the time to flush the updated graph to ES has come, one can call cache.flush()

All the in-memory-updated entities will be written to ES indices, and all cache data will be cleared.

## **Limitations**

No ACIDITY or transactions

ElasticSearch also does not provide transactions or acidity. In EG, since a single update also updates rest of the graph, but first in memory, and then altogether flushed into ElasticSearch, it is possible that another process may have updated a part of updated graph in meantime. If so flushing of this subgraph update will throw an error because someone already updated part of the subgraph before. This will lead to a partial subgraph update. 

When using EG for denormalisation and dependency management, one has to be OK with possible errors in maintenance of the graph state.* If you need strict ACID behavior in  your application, its best to use a transactional database as your primary datastore and use EG/ES as your secondary datastore for read/search/analytic queries at scale and speed.*

## **Setup and configuration**

  

* Install ElaticSearch v2.x (5.x not supported yet)

* Setup the EG configurations folder TODO add a sample EG configuration

* Generate the ES mappings - TODO push esMappingGenerator to ElasticGraph repo.

* Edit these mappings as you like, for your particular use case.

* Generate elasticsearch indexes with those mappings

* Import EG npm into your NodeJS app, or use the ElasticGraph REST server

* Start playing around with your awesome data model!

### **Configuration**

[Coming soon]

## **Tutorial**

[Coming soon]

## **API**

[Coming soon]

For now open up the lib/search,get,create,update,link.js files and check the documentation and test cases in those. A full API doc shall be made soon.

The current documentation is bit outdated. Please use it to get a feeling of how the API is, till the correct version is put up.

Let me know what you think about ElasticGraph. Share with your friends and colleagues if you like it. Your feedback and suggestions are welcome.

