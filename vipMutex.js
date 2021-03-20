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
  const _waitInLine = (myKey, myLock) => {
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
  const _waitInLineVip = (myKey, myLock) => {
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
  const lock = () => {
    let myKey; // this is a function returned to caller to let them unlock once they're done

    // represents the caller's lock, which only they may unlock (by calling myKey)
    const myLock = new Promise((resolve) => (myKey = _getKey(resolve)));

    return _waitInLine(myKey, myLock); // caller should await for their myKey function
  };

  /**
   * * Same as .lock, but skip the line as a VIP task (will still line up behind other VIP tasks)
   * ! Failure to call unlock will result in all requests waiting for the mutex to wait forever!
   * * Usage:
   * const unlock = await mutex.lockVip();
   * try { <do critical path> } finally { unlock(); }
   */
  const lockVip = async () => {
    let myKey;
    const myLock = new Promise((resolve) => (myKey = async () => resolve())); // myLock is resolved by myKey... simple!

    const _unlockMtx = await _mtx.lock(); // prevent race-condition w/ mutex-unlocker
    try {
      if (_count > 0) return _waitInLineVip(myKey, myLock); // line up as VIP, mutex-holder will unlock us
    } finally {
      _unlockMtx();
    }

    // else if there's no mutex-holder (to unlock VIPs), then just line up as non-VIP
    return _waitInLine(myKey, myLock);
  };

  /**
   * First, wait for mutex lock, then run the passed in executor function, and finally, release the lock.
   * @param {Function} executor function (can be async) containing the critical code
   * @param args arguments to pass into executor
   * @returns return value of executor (or its fulfilled result if it's a promise)
   * Usage: `await mutex.run(<executor>)` or `mutex.run(..).then(result => ..)`
   * Advanced:
   *   const unsafe = async (x, y) => { <do critical stuff> };
   *   const safe = async (...args) => await mutex.run(unsafe, ...args);
   *   await safe("foo", "bar");
   */
  const run = async (executor, ...args) => {
    const unlock = await lock();
    try {
      return await executor(...args);
    } finally {
      unlock();
    }
  };

  /**
   * Same as .run, but skip the line as a VIP task (will still line up behind other VIP tasks)
   * * Usage: `await mutex.runVip(<executor>)` or `mutex.runVip(..).then(result => <etc.>)`
   */
  const runVip = async (executor, ...args) => {
    const unlock = await lockVip();
    try {
      return await executor(...args);
    } finally {
      unlock();
    }
  };

  return {
    run,
    runVip,
    lock,
    lockVip,
  };
}

module.exports = makeVipMutex;
