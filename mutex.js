/**
 * Mutex implementation using Promises to prevent race conditions in concurrent programs
 * ! This will not prevent race conditions in parallel processes!
 * For more, see: https://www.nodejsdesignpatterns.com/blog/node-js-race-conditions/
 */
function makeMutex() {
  //* The mutually exclusive lock that only one (concurrent) task at a time may hold:
  let _lock = Promise.resolve(); // "resolved" represents "unlocked"

  /**
   * * Attempt to acquire the currentLock
   * @returns a promise that eventually (when it's your turn) resolves to the "unlock" function
   * (which must be called when you're done with the mutex)
   * ! Failure to call unlock will result in all requests waiting for the mutex to wait forever!
   * * Usage:
   * const unlock = await mutex.lock();
   * try { <do critical path> } finally { unlock(); }
   */
  const lock = () => {
    let myKey; // this is a function returned to caller to let them unlock once they're done

    //* represents a new "locked" lock, which will only be "unlocked" once its resolved
    const myLock = new Promise((resolve) => {
      // unlock will release this newLock (by resolving it)
      myKey = () => resolve(); // explicitly call resolve() w/ no args to discard a malicious caller's args
    });

    // Caller is promised the lock (once it's unlocked)
    // THEN, the promise resolves to the unlock function for the newLock
    const promiseOfKey = _lock.then(() => myKey);
    // The next request will have to wait on this newLock (until caller is done and calls unlock)
    _lock = myLock;
    // Return promise of the unlock function, which caller should await on
    return promiseOfKey;
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
  const run = async (callback, ...args) => {
    const unlock = await lock();
    try {
      return await callback(...args);
    } finally {
      unlock();
    }
  };

  return {
    lock, run
  };
}

module.exports = makeMutex;
