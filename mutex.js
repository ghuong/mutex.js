"use strict";

/**
 * Mutex implementation using Promises to prevent race conditions in concurrent programs
 * ! This will not prevent race conditions in parallel processes!
 * For more, see: https://www.nodejsdesignpatterns.com/blog/node-js-race-conditions/
 */
function Mutex() {
  // The exclusive lock that only one (concurrent) task may hold:
  let _mutex = {
    lock: Promise.resolve(), // "resolved" promise represents "unlocked"
    key: null, // doesn't need a key
  };

  // a queue of requests lining up for the mutex
  // holds objects: { lock, key }, where:
  // - lock: is a promise that gives away its resolve function.
  // - key: is a promise of said resolve function. The caller is meant to call it when they're done with the lock.
  //        The key-promise is then'd onto the previous lock (so only once the previous lock resolves, THEN the key does)
  let _lineUp = [];

  const _noLineUp = () => _lineUp.length === 0; // whether there's a line up
  const _lastInLine = () => _lineUp[_lineUp.length - 1]; // who to wait after
  const _nextInLine = () => _lineUp[0]; // who's next in line to be admitted
  const _waitInLine = (lock, key) => _lineUp.push({ lock, key }); // line up at the end
  const _cutInLine = (lock, key) => _lineUp.unshift({ lock, key }); // cut to the front
  const _admitNext = () => _mutex = _lineUp.shift(); // admit next in line

  /**
   * * Attempt to acquire the currentLock
   * @returns a promise of "lock acquisition" that, when resolved, returns
   * a "releaseLock" function (which must be called to release the lock when you're done with it)
   * ! Failure to call releaseLock will result in all subsequent requests waiting forever for the lock!
   * * Usage:
   * const unlock = await mutex.lock();
   * try { <do critical path> } finally { unlock(); }
   */
  this.lock = () => {
    let _unlock; // this is a function returned to caller to let them unlock once they're done

    // represents our lock, to which only we hold the key to unlock
    const lock = new Promise((resolve) => {
      // our "unlock" function will unlock our lock (by resolving it)
      _unlock = () => resolve(); // explicitly call resolve() w/ no args to discard a malicious caller's args
    });

    const { lock: whoToWaitFor } = _noLineUp() ? _mutex : _lastInLine(); // the lock we must wait for

    // Once the task in front of us is done...
    const key = whoToWaitFor.then(() => {
      // THEN
      _admitNext(); // we should be the next to go
      return _unlock; // our key-promise resolves to our "unlock" function for our lock
    });

    _waitInLine(lock, key); // enter line up (even if it's empty)
    return key; // return promise of unlock function, which caller should await on
  };

  /**
   * First, wait for mutex lock, then run the passed in callback, finally, release the lock
   * @param {Function} callback function (can be async) containing the critical code
   * @param args arguments to pass into callback
   * @returns return value of callback
   * Usage: `await mutex.run(<callback function>)` or `mutex.run(..).then(result => ..)`
   * Advanced:
   *   const runCriticalPath = async (x, y) => { <do critical stuff> };
   *   const runProtected = async (...args) => await mutex.run(runCriticalPath, ...args);
   *   await runProtected("foo", "bar");
   */
  this.run = async (callback, ...args) => {
    const unlock = await this.lock();
    try {
      return await callback(...args);
    } finally {
      unlock();
    }
  };
}

const randomDelay = () =>
  new Promise((resolve) => setTimeout(resolve, Math.random() * 100));

let balance = 0; // global balance
const mutex = new Mutex();

async function loadBalance() {
  await randomDelay(); // simulate delay retrieving data from db
  return balance;
}

async function saveBalance(value) {
  await randomDelay(); // simulate delay writing data to db
  balance = value;
}

/**
 * Sell product for $50
 * @param {String} product name of product
 */
const _sell = async (product) => {
  const balance = await loadBalance();
  console.log(`sell ${product} - balance loaded: ${balance}`);
  const newBalance = balance + 50;
  await saveBalance(newBalance);
  console.log(`sell ${product} - balance updated: ${newBalance}`);
};

// wrap sell function in mutex lock:
const safeSell = async (...args) => await mutex.run(_sell, ...args);

const main = async () => {
  await Promise.all([
    safeSell("grapes"),
    safeSell("olives"),
    safeSell("rice"),
    safeSell("beans"),
  ]);
  const balance = await loadBalance();
  console.log(`Final balance: $${balance}`); // should be $200
};

main();
