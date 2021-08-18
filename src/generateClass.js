import Web3PromiEvent from 'web3-core-promievent';

function checkWeb3(web3) {
  if (typeof web3.version !== 'string' || !web3.version.startsWith('1.')) {
    throw new Error('web3 version 1.x is required');
  }
}

const validOptKeys = ['from', 'to', 'gasPrice', 'gas', 'value', 'data', 'nonce'];
const filterOpts = (opts) => {
  const validOpts = {};

  validOptKeys.forEach((key) => {
    validOpts[key] = opts[key];
  });

  return validOpts;
};

const estimateGas = (web3, method, opts) => {
  if (opts.$noEstimateGas) return Promise.resolve(4700000);
  if (opts.$gas || opts.gas) return Promise.resolve(opts.$gas || opts.gas);

  const o = filterOpts(opts);
  // remove nonce from estimateGas. It isn't necessary and causes
  // ganache-cli to error when submitting multiple txs asynchronously
  // before the 1st has been mined
  delete o.nonce;
  return method.estimateGas(o)
    // eslint-disable-next-line no-confusing-arrow
    .then(gas => opts.$extraGas ? gas + opts.$extraGas : Math.floor(gas * 1.1));
};

// if constant method, executes a call, otherwise, estimates gas and executes send
const execute = (web3, txObject, opts, cb) => {
  const { _method } = txObject;

  if (_method.constant) return txObject.call(filterOpts(opts));

  // we need to create a new PromiEvent here b/c estimateGas returns a regular promise
  // however on a 'send' we want to return a PromiEvent
  const defer = new Web3PromiEvent();
  const relayEvent = event => (...args) => defer.eventEmitter.emit(event, ...args);

  estimateGas(web3, txObject, opts)
    .then((gas) => {
      // 21272 is min gas to work in older versions of ganache-cli
      const filteredOpts = Object.assign({}, filterOpts(opts), { gas: (gas < 21272) ? 21272 : gas });
      return (cb) ? txObject.send(filteredOpts, cb) : txObject.send(filteredOpts)
        // relay all events to our promiEvent
        .on('transactionHash', relayEvent('transactionHash'))
        .on('confirmation', relayEvent('confirmation'))
        .on('receipt', (r) => {
          if (opts.verbose) {
            console.log(r.gasUsed);
          }
          return relayEvent('receipt')(r);
        })
        .on('error', relayEvent('error'));
    })
    .then(defer.resolve)
    .catch(defer.reject);

  return defer.eventEmitter;
};

const methodWrapper = (web3, method, ...args) => {
  let cb;
  let opts = {};

  if (typeof args[args.length - 1] === 'function') cb = args.pop();
  if (typeof args[args.length - 1] === 'object' && !Array.isArray(args[args.length - 1])) opts = args.pop();

  const txObject = method(...args);

  return execute(web3, txObject, opts, cb);
};


export default (abi, bytecode = '') => {
  if (!abi) throw new Error('missing abi');
  if (bytecode && !bytecode.startsWith('0x')) bytecode = '0x' + bytecode;

  const C = function C(web3, address) {
    checkWeb3(web3);

    this.$web3 = web3;
    this.$address = address;
    this.$contract = new web3.eth.Contract(abi, address);
    this.$abi = abi;
    this.$byteCode = bytecode;


    Object.keys(this.$contract.methods)
      .filter(key => !key.startsWith('0x'))
      .forEach((key) => {
        this[key] = (...args) => methodWrapper(web3, this.$contract.methods[key], ...args);
      });

        // set default from address
    web3.eth.getAccounts()
      .then((accounts) => {
        this.$contract.options.from = (accounts.length > 0) ? accounts[0] : undefined;
      })
      .catch();
  };

  C.new = function (web3, ...args) {
    if (!bytecode || bytecode === '0x') throw new Error('missing bytecode');

    let opts = {};
    if (args && args.length > 0 && typeof args[args.length - 1] === 'object') {
      opts = args.pop();
    }

    const deploy = new web3.eth.Contract(abi)
      .deploy({
        data: bytecode,
        arguments: args,
      });

    const getAccount = () => {
      if (opts.from) return Promise.resolve(opts.from);

      return web3.eth.getAccounts()
        // eslint-disable-next-line no-confusing-arrow
        .then(accounts => (accounts.length > 0) ? accounts[0] : undefined);
    };

    // we need to create a new PromiEvent here b/c getAccount returns a regular promise
    // however on a 'deploy' we want to return a PromiEvent
    const defer = new Web3PromiEvent();
    const relayEvent = event => (...params) => defer.eventEmitter.emit(event, ...params);

    getAccount()
      .then(account => Object.assign(opts, { from: account }))
      .then(() => execute(web3, deploy, opts)
            // relay all events to our promiEvent
            .on('transactionHash', relayEvent('transactionHash'))
            .on('confirmation', relayEvent('confirmation'))
            .on('receipt', relayEvent('receipt'))
            .on('error', relayEvent('error')),
      )
      .then(contract => new C(web3, contract.options.address))
      .then(defer.resolve)
      .catch(defer.reject);

    return defer.eventEmitter;
  };

  return C;
};
