'use strict';
require('./common.js');

describe('testing elasticgraph', function() {

  this.timeout(15000);

  describe('collect API', () => {
    before(() => {
      let objects = [
        {index: 'tests', type: 'test', id: 1, body: {field : "Test 1"}},
        {index: 'tests', type: 'test', id: 2, body: {field : "Test 2"}},
      ]

      objects.forEach((object) => {
        es.create(object)
      })

      console.log("\tObjects have been created for testing")
    })

    require('./collect/get/index');
    require('./collect/get/mget');
    require('./collect/index/index');
    require('./collect/search/index');
    require('./collect/search/multi_search');
    //bulk delete opration for created test documents
    require('./collect/bulk/index');
    require('./collect/aggregator.js');
  });

  describe('DSL API', () => {
    require('./dslEngine/booleanExpression')
    require('./dslEngine/search')
    require('./dslEngine/async')
    });

    describe('deep API', () => {

   });
});
