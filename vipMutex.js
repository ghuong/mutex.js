const makeMutex = require("./mutex");

/**
 * Mutex with VIP (skip the line) functionality
 * ! This will not prevent race conditions in parallel processes!
 * For more, see: https://www.nodejsdesignpatterns.com/blog/node-js-race-conditions/
 */
function makeVipMutex() {
  let _count = 0; // number of non-VIP tasks waiting in mutex (plus the one with the lock)
  // The most recent lock (at the end of queue / last-in-line) that the next task must wait for:
  let _lock = Promise.resolve(); // "resolved" represents "unlocked"

  /**
   * This internal mutex prevents the race condition where the current holder of
   * the VipMutex unlocks and gives all the queued VIP tasks a chance to go,
   * but then a new VIP task lines up which the mutex-holder doesn't know to wait for,
   * followed by unblocking the next-in-line non-VIP task,
   * thus leading to a race between the VIP and non-VIP tasks
   */
  let _mtx = makeMutex();

  let _vipLock; // like _lockLastInLine, but for VIP tasks (this is the last-in-line VIP)
  let _vipKey; // unlocks the next-in-line (first) VIP, which will eventually unlock all other VIPs, in queued order

  /**
   * Initialize the first (empty) VIP lock WHEN there are no VIP tasks waiting
   * Note: unlike _lockLastInLine, which begins unlocked, _vipLockLastInLine begins locked
   * and is only unlocked once _unlockNextInLineVip is called (by the current mutex-holder)
   */
  const _initVipLock = () =>
    (_vipLock = new Promise((resolve) => (_vipKey = resolve)));

  _initVipLock(); // sets the first VIP lock

  /**
   * Line up for entry into the mutex
   * @param {Function} myKey the function that resolves myLock
   * @param {Promise} myLock the promise that is resolved by calling myKey
   * @returns a promise of myKey
   */
  const _lineUp = (myKey, myLock) => {
    const promiseOfKey = _lock.then(() => myKey);
    _lock = myLock; // next task must wait on myLock
    _count++; // add ourselves to the count
    return promiseOfKey;
  };

  /**
   * Line up for entry into the mutex, in the VIP queue
   * @param {Function} myKey the function that resolves myLock
   * @param {Promise} myLock the promise that is resolved by calling myKey
   * @returns a promise of myKey
   */
  const _lineUpAsVip = (myKey, myLock) => {
    const promiseOfKey = _vipLock.then(() => myKey);
    _vipLock = myLock;
    return promiseOfKey;
  };

  /**
   * Get the key unlock function for a non-VIP mutex holder
   * @param {Function} resolve resolve function for the promise-lock
   * @returns an unlock function that yields mutex to VIP tasks first, before non-VIP
   */
  const _getKey = (resolve) => async () => {
    const _unlockMtx = await _mtx.lock();
    try {
      // At this point, the current mutex-holder is done
      // Before unlocking, check if there are VIP tasks waiting and let them go first
      _vipKey(); // unlocks the next-in-line (first) VIP, which will eventually unlock all of them
      await _vipLock; // wait for the last VIP to finish
      _initVipLock(); // now that VIP queue is empty, re-initialize the first empty VIP lock

      _count--; // finally, remove ourselves from the count
      resolve(); // let the next non-VIP task go
    } finally {
      _unlockMtx();
    }
  };

  /**
   * * Attempt to acquire sole "mutually-exclusive" access to the lock
   * Caller is promised eventual mutex access (in reality, it means they wait until they get back their "myKey" function)
   * @returns a promise that eventually (when it's your turn) resolves to the "myKey" function
   * (which must be called when you're done with the mutex)
   * ! Failure to call unlock will result in all requests waiting for the mutex to wait forever!
   * * Usage:
   * const unlock = await mutex.lock();
   * try { <do critical path> } finally { unlock(); }
   */
  const lock = async (_isVIP = false) => {
    let myKey; // this is a function returned to caller to let them unlock once they're done
    let myLock; // represents the caller's lock, which only they may unlock (by calling myKey)

    if (_isVIP) {
      myLock = new Promise((resolve) => (myKey = async () => resolve())); // myLock is resolved by myKey... simple!

      // VIP tasks will line up in the VIP queue to skip ahead of non-VIP tasks waiting
      const _unlockMtx = await _mtx.lock();
      try {
        if (_count > 0) {
          // if someone's holding mutex, line up as VIP, mutex-holder will unlock us, but if not, line up normally (see end of function)
          return _lineUpAsVip(myKey, myLock);
        }
      } finally {
        _unlockMtx();
      }
      // });
    } else {
      myLock = new Promise((resolve) => (myKey = _getKey(resolve)));
    }

    // if non-VIP, or if nobody's currently holding mutex, just line up normally
    return _lineUp(myKey, myLock); // caller should await for their myKey function
  };

  /**
   * * Same as .lock, but skip the line as a VIP task (will still line up behind other VIP tasks)
   * @returns a promise that eventually (when it's your turn) resolves to the "unlock" function
   * (which must be called when you're done with the mutex)
   * ! Failure to call unlock will result in all requests waiting for the mutex to wait forever!
   * * Usage:
   * const unlock = await mutex.lockVip();
   * try { <do critical path> } finally { unlock(); }
   */
  const lockVip = async () => await lock(true);

  // Wraps the given executor function in lock / unlock calls with try-finally blocks
  const _run = async (executor, vip, ...args) => {
    const unlock = await lock(vip);
    try {
      return await executor(...args);
    } finally {
      unlock();
    }
  };

  /**
   * First, wait for mutex lock, then run the passed in executor function, and finally, release the lock.
   * @param {Function} executor function (can be async) containing the critical code
   * @param args arguments to pass into executor function
   * @returns return value of executor function (or its fulfilled result if it's a promise)
   * Usage: `await mutex.run(<executor function>)` or `mutex.run(..).then(result => ..)`
   * Advanced:
   *   const runCriticalPath = async (x, y) => { <do critical stuff> };
   *   const runProtected = async (...args) => await mutex.run(runCriticalPath, ...args);
   *   await runProtected("foo", "bar");
   */
  const run = async (executor, ...args) =>
    await _run(executor, false, ...args);

  /**
   * Same as .run, but VIP tasks are served first
   */
  const runVip = async (executor, ...args) =>
    await _run(executor, true, ...args);

  return {
    run,
    runVip,
    lock,
    lockVip,
  };
}

module.exports = makeVipMutex;
