"use strict";

/**
 * Mutex implementation using Promises to prevent race conditions in concurrent programs
 * ! This will not prevent race conditions in parallel processes!
 * For more, see: https://www.nodejsdesignpatterns.com/blog/node-js-race-conditions/
 */
function Mutex() {
  //* The mutually exclusive lock that only one (concurrent) task at a time may hold:
  let _currentLock = Promise.resolve(); // "resolved" represents "unlocked"

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

    //* represents a new "locked" lock, which will only be "unlocked" once its resolved
    const newLock = new Promise((resolve) => {
      // unlock will release this newLock (by resolving it)
      _unlock = () => resolve(); // explicitly call resolve() w/ no args to discard a malicious caller's args
    });

    // Caller is promised the lock (once it's unlocked)
    // THEN, the promise resolves to the unlock function for the newLock
    const promiseOfUnlock = _currentLock.then(() => _unlock);
    // The next request will have to wait on this newLock (until caller is done and calls unlock)
    _currentLock = newLock;
    // Return promise of the unlock function, which caller should await on
    return promiseOfUnlock;
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
