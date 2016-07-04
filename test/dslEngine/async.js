'use strict';

describe('async', () => {
  it('aysnc: get all the test documents in *arr', (done) => {
    let ctx = { arr: [1,2]}
    const asyncEachThenGet = [
      'async each *arr as i',
        [
          'get test *i',
        ]
    ]
    const result = es.dsl.execute(asyncEachThenGet, ctx);

    result.should.be.fulfilled.then((res) => {
      expect(res)
        .to.be.an('array')
        .and.to.have.lengthOf(2)
    })
    .should.notify(done)
  })

})
