it('Get response', function(done){
  var results = es.get.collect({id: 1, index: 'tests', type: 'test'});
  results.should.be.fulfilled.then(function(res){
    expect(res)
    .to.be.an('object')
    .and.to.contain.all.keys(['_index', '_type', '_id', '_version', 'found', '_source'])
  }).catch().should.notify(done);
});
