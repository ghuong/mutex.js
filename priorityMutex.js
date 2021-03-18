const Mutex = require("./mutex");

/**
 * Mutex implementation using Promises to prevent race conditions in concurrent programs
 * ! This will not prevent race conditions in parallel processes!
 * For more, see: https://www.nodejsdesignpatterns.com/blog/node-js-race-conditions/
 */
class PriorityMutex {
  constructor() {
    this._currentLock = Promise.resolve(); // "resolved" represents "unlocked"
    this._currentVipLock = this.setVipLock(); // VIP lock to wait for
    this._unlockAllVipLocks; // unlocks all VIP locks
    this._vipMutex = new Mutex();
  }

  setVipLock() {
    this._currentVipLock = new Promise(resolve => this._unlockAllVipLocks = resolve);
  }

  /**
   * * Attempt to acquire the currentLock
   * @returns a promise of "lock acquisition" that, when resolved, returns
   * a "releaseLock" function (which must be called to release the lock when you're done with it)
   * ! Failure to call releaseLock will result in all subsequent requests waiting forever for the lock!
   * * Usage:
   * const unlock = await mutex.lock();
   * try { <do critical path> } finally { unlock(); }
   */
  lock() {
    let _unlock; // this is a function returned to caller to let them unlock once they're done

    //* represents a new "locked" lock, which will only be "unlocked" once its resolved
    const newLock = new Promise((resolve) => {
      // At this point, we've released the lock
      // unlock will release this newLock (by resolving it)
      _unlock = async () => {
        resolve(); // explicitly call resolve() w/ no args to discard a malicious caller's args
      }
    });

    // Caller is promised the lock (once it's unlocked)
    // THEN, the promise resolves to the unlock function for the newLock
    const promiseOfUnlock = this._currentLock.then(() => {
      // At this point, we've acquired the lock successfully...
      return _unlock;
    });

    // The next request will have to wait on this newLock (until caller is done and calls unlock)
    this._currentLock = newLock;
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
  async run(callback, ...args) {
    const unlock = await this.lock();
    try {
      return await callback(...args);
    } finally {
      unlock();
    }
  };
}

module.exports = PriorityMutex;