global.chai = require('chai');
chai.use(require('chai-as-promised'));
global.should = chai.should();
global.expect = chai.expect;
global.assert = chai.assert;

var ElasticGraph = require('../index')

global.config = require('../config')
global.es = new ElasticGraph('newConfig/')
