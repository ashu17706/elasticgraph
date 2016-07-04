it('Request should be triggered after the timeout in config.timeouts', (done) => {
  var startTime = new Date().getTime();

    var results = es.get.collect({id: 1, index: 'tests', type: 'test'});

    results.should.be.fulfilled.then(() => {
      var finalTime = new Date().getTime() - startTime;

      expect(finalTime).to.be.above(config.timeouts.get);
    }).catch().should.notify(done);
});

// it('Request shold be triggered after collecting config.batch_size.{function name} requests', (done) => {
//
// }).should.notify(done);
