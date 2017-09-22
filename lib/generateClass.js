'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

var _web3CorePromievent = require('web3-core-promievent');

var _web3CorePromievent2 = _interopRequireDefault(_web3CorePromievent);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function checkWeb3(web3) {
  if (typeof web3.version !== 'string' || !web3.version.startsWith('1.')) {
    throw new Error('web3 version 1.x is required');
  }
}

var estimateGas = function estimateGas(web3, method, opts) {
  if (opts.$noEstimateGas) return Promise.resolve(4700000);
  if (opts.$gas || opts.gas) return Promise.resolve(opts.$gas || opts.gas);

  return method.estimateGas(opts)
  // eslint-disable-next-line no-confusing-arrow
  .then(function (gas) {
    return opts.$extraGas ? gas + opts.$extraGas : Math.floor(gas * 1.1);
  });
};

// if constant method, executes a call, otherwise, estimates gas and executes send
var execute = function execute(web3, txObject, opts, cb) {
  var _method = txObject._method;


  console.log('method ->', _method);
  if (_method.constant) return txObject.call(opts);

  // we need to create a new PromiEvent here b/c estimateGas returns a regular promise
  // however on a 'send' we want to return a PromiEvent
  var defer = new _web3CorePromievent2.default();
  var relayEvent = function relayEvent(event) {
    return function () {
      var _defer$eventEmitter;

      for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
        args[_key] = arguments[_key];
      }

      return (_defer$eventEmitter = defer.eventEmitter).emit.apply(_defer$eventEmitter, [event].concat(args));
    };
  };

  estimateGas(web3, txObject, opts).then(function (gas) {
    Object.assign(opts, { gas: gas });
    return cb ? txObject.send(opts, cb) : txObject.send(opts)
    // relay all events to our promiEvent
    .on('transactionHash', relayEvent('transactionHash')).on('confirmation', relayEvent('confirmation')).on('receipt', relayEvent('receipt')).on('error', relayEvent('error'));
  }).then(defer.resolve).catch(defer.reject);

  return defer.eventEmitter;
};

var methodWrapper = function methodWrapper(web3, method) {
  for (var _len2 = arguments.length, args = Array(_len2 > 2 ? _len2 - 2 : 0), _key2 = 2; _key2 < _len2; _key2++) {
    args[_key2 - 2] = arguments[_key2];
  }

  var cb = void 0;
  var opts = {};

  if (typeof args[args.length - 1] === 'function') cb = args.pop();
  if (_typeof(args[args.length - 1]) === 'object') opts = args.pop();

  var txObject = method.apply(undefined, args);

  return execute(web3, txObject, opts, cb);
};

exports.default = function (abi, bytecode) {
  var C = function C(web3, address) {
    var _this = this;

    checkWeb3(web3);

    this.$web3 = web3;
    this.$address = address;
    this.$contract = new web3.eth.Contract(abi, address);
    this.$abi = abi;
    this.$byteCode = bytecode;

    Object.keys(this.$contract.methods).filter(function (key) {
      return !key.startsWith('0x');
    }).forEach(function (key) {
      _this[key] = function () {
        for (var _len3 = arguments.length, args = Array(_len3), _key3 = 0; _key3 < _len3; _key3++) {
          args[_key3] = arguments[_key3];
        }

        return methodWrapper.apply(undefined, [web3, _this.$contract.methods[key]].concat(args));
      };
    });

    // set default from address
    web3.eth.getAccounts().then(function (accounts) {
      _this.$contract.options.from = accounts.length > 0 ? accounts[0] : undefined;
    });
  };

  C.new = function (web3) {
    for (var _len4 = arguments.length, args = Array(_len4 > 1 ? _len4 - 1 : 0), _key4 = 1; _key4 < _len4; _key4++) {
      args[_key4 - 1] = arguments[_key4];
    }

    var opts = {};
    if (args && args.length > 0 && _typeof(args[args.length - 1]) === 'object') {
      opts = args.pop();
    }

    var deploy = new web3.eth.Contract(abi).deploy({
      data: bytecode,
      arguments: args
    });

    var getAccount = function getAccount() {
      if (opts.from) return Promise.resolve(opts.from);

      return web3.eth.getAccounts()
      // eslint-disable-next-line no-confusing-arrow
      .then(function (accounts) {
        return accounts.length > 0 ? accounts[0] : undefined;
      });
    };

    return getAccount().then(function (account) {
      return Object.assign(opts, { from: account });
    }).then(function () {
      return execute(web3, deploy, opts);
    }).then(function (contract) {
      return new C(web3, contract.options.address);
    });
  };

  return C;
};