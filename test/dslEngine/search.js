'use strict';

describe('search', ()=> {
  it('search test where {_id: 200} as test should return no hits', (done)=> {
    const result = es.dsl.execute(['search test where {_id: 200} as test'], {})

    result.should.be.fulfilled.then((res) => {
      expect(res)
        .to.be.an('object')
        .and.to.contain.all.keys(["took", "timed_out", "_shards", "hits"])
        .and.to.have.deep.property('hits.total').to.be.equal(0)
    }).should.notify(done)
  })

  it('search test where {_id: 1} as test should return 1 hits', (done) => {
    const result = es.dsl.execute(['search test where {_id: 150}. Create if not exists'], {})

    result.should.be.fulfilled.then((res) => {
      expect(res)
        .to.be.an('object')
        .and.to.contain.all.keys(["took", "timed_out", "_shards", "hits"])
        .and.to.have.deep.property('hits.total').to.be.equal(1)
    }).should.notify(done)
  })

  // it('search first test  where {_id: 1} as test should return only first result', (done) => {
  //   // let ctx = {"name" : "Ashutosh Tripathi"}
  //   const result = es.dsl.execute(['search first test where {_id: 1} as test'], {})
  //
  //   result.should.be.fulfilled.then((res) => {
  //     expect(res)
  //       .to.be.an('object')
  //       .and.to.contain.all.keys(["_type", "_index", "_score", "_id", "_source"])
  //   }).should.notify(done)
  // })
})
