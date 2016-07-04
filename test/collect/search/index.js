it('Search Response', (done) => {
  var results = es.search.collect({index: 'tests', query: {match: {field: 'Test 2'}}});

  results.should.be.fulfilled.then((res) => {
    expect(res).to.be.an('object')
    .and.to.have.all.keys(['took', 'timed_out', '_shards', 'hits'])
  }).should.notify(done);
});
