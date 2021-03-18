const Mutex = require("./mutex");

/**
 * Mutex implementation using Promises to prevent race conditions in concurrent programs
 * ! This will not prevent race conditions in parallel processes!
 * For more, see: https://www.nodejsdesignpatterns.com/blog/node-js-race-conditions/
 */
class PriorityMutex {
  constructor() {
    this._count = 0; // number of non-VIP tasks waiting in line
    this._currentLock = Promise.resolve(); // "resolved" represents "unlocked"
    
    this._internalMutex = new Mutex(); // mutex in the mutex
    this._vipMutex = new Mutex(); // two mutexes in the mutex
    
    this._currentVipLock;
    this._unlockAllVipLocks; // unlocks all VIP locks

    this._initVipLock(); // VIP lock to wait for
  }

  _initVipLock() {
    this._currentVipLock = new Promise(
      (resolve) => (this._unlockAllVipLocks = resolve)
    );
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
  async lock(vip = false) {
    const unlockInternalMutex = await this._internalMutex.lock();
    try {
      let _unlock; // this is a function returned to caller to let them unlock once they're done

      //* represents a new "locked" lock, which will only be "unlocked" once its resolved
      let newLock;
      if (vip) {
        newLock = new Promise((resolve) => (_unlock = async () => resolve()));
      } else {
        // non-VIP
        newLock = new Promise((resolve) => {
          // unlock will release this newLock (by resolving it)
          _unlock = async () => {
            // At this point, the caller is done with their lock
            const unlockVipMutex = await this._vipMutex.lock(); // to prevent new tasks from adding themselves to Vip queue
            try {
              this._unlockAllVipLocks(); // unlocks the first Vip lock, which will eventually unlock all of them
              // console.log("await currentVipLock");
              await this._currentVipLock; // wait for the very last one to finish
              // console.log("done waiting for currentVipLock");
              this._initVipLock(); // initialize the first empty lock
            } finally {
              unlockVipMutex(); // release the vip mutex
            }
            // unlock our lock, to let the next non-Vip task go
            this._count--; // remove ourselves from the count
            resolve(); // explicitly call resolve() w/ no args to discard a malicious caller's args
          };
        });
      }

      // Caller is promised the lock (once it's unlocked)
      // THEN, the promise resolves to the unlock function for the newLock
      let promiseOfUnlock;
      if (vip && this._count > 0) {
        const unlockVipMutex = await this._vipMutex.lock();
        try {
          promiseOfUnlock = this._currentVipLock.then(() => _unlock);
        } finally {
          unlockVipMutex();
        }
      } else {
        promiseOfUnlock = this._currentLock.then(() => _unlock); // non-VIP
        this._count++; // add ourselves to count
      }

      if (vip) {
        this._currentVipLock = newLock;
      } else {
        this._currentLock = newLock; // next request must wait on this newLock
      }
      // Return promise of the unlock function, which caller should await on
      return promiseOfUnlock;
    } finally {
      unlockInternalMutex();
    }
  }

  async _run(executor, vip, ...args) {
    const unlock = await this.lock(vip);
    try {
      return await executor(...args);
    } finally {
      unlock();
    }
  }

  /**
   * First, wait for mutex lock, then run the passed in callback, finally, release the lock
   * @param {Function} executor function (can be async) containing the critical code
   * @param args arguments to pass into callback
   * @returns return value of callback
   * Usage: `await mutex.run(<callback function>)` or `mutex.run(..).then(result => ..)`
   * Advanced:
   *   const runCriticalPath = async (x, y) => { <do critical stuff> };
   *   const runProtected = async (...args) => await mutex.run(runCriticalPath, ...args);
   *   await runProtected("foo", "bar");
   */
  async run(executor, ...args) {
    return await this._run(executor, false, ...args);
  }

  /**
   * Same as run, but Vip tasks are served first
   */
  async runVip(executor, ...args) {
    return await this._run(executor, true, ...args);
  }
}

module.exports = PriorityMutex;
