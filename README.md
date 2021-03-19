# Mutex.js

## About

This is a Promise-based Mutex implementation for preventing race conditions in concurrent (but non-parallel) programs in Node.js.

The twist is that it provided the option for a task to "skip the line" waiting for the mutex, jumping to the very front as a "VIP" task. See later section `VipMutex.js`.

### Are Race Conditions Possible in Node.js?

Yes.

Even though Node.js is single-threaded, race conditions are still possible if there are concurrent tasks reading and writing to the same shared resource.

For instance, two asynchronous tasks A and B may attempt to read from an account balance (say, $0), and then increment it, each by $50. The correct resulting balance should be $100. But what if, in a single-threaded environment, the order of operations happened to be like so:

**A**: Read Balance from DB: **$0**

**A**: Calculate: (0 + 50 = 50) *--> Context-Switch!*

**B**: Read Balance from DB: **$0** _(stale read)_ *--> Context-Switch!*

**A**: Write Balance to DB: **$50** _(Updated!)_ *--> Context-Switch!*

**B**: Calculate: (0 + 50 = 50) _(based on stale value)_

**B**: Write Balance to DB: **$50** _(overwrite A's update)_

In this case, the resulting erroneous balance is $50 because both tasks were racing to read/write to the same resource.

One solution is to protect the _critical path_, i.e. the parts of code that read/write to shared resources, so that only one task can execute at a time. This would render that code "mutually exclusive". 

Enter:

## Mutex.js

### Getting Started

Run `main.js` to demonstrate two examples with and without the use of a mutex:

```bash
node main.js
```

## Usage

To use the basic `Mutex` in `mutex.js`:

```js
const mutex = new Mutex(); // instantiate

async function doCriticalThing() {
  const unlock = await mutex.lock(); // wait to get lock
  try {
    // do critical things...
    return whatever;
  } finally {
    unlock(); // unlock once done
  }
}
```

_Note:_ Use a finally-block to ensure `unlock` always gets called, even if the try-block throws an error. Failure to call `unlock` will cause all tasks waiting for the mutex to wait forever!

### `.run`

For this reason, the `run` function is also provided which just wraps your code with the `lock` / `unlock` calls and `try-finally` blocks. Wrap any non-safe function to protect it:

```js
function unsafe() { etc. }

const safe = async () => await mutex.run(unsafe);

async function main() { await safe(); await safe(); }
// async function main() { await unsafe(); await unsafe(); }
```

Or, if your function takes arguments, use rest / spread syntax to pass them in:

```js
const safe = async(...args) => await mutex.run(unsafe, ...args);
```

The long-form, as a function declaration, is equivalent:

```js
async function safe(...args) { 
  return await mutex.run(unsafe, ...args);
}
```

Alternatively, just run any anonymous function in-line:

```js
const balance = await mutex.run(
  async () => await loadBankBalance()
);
```

### How it Works

As mentioned, this implementation is based on Promises. 

## `VipMutex`

The class `VipMutex`, from `vipMutex.js` can be used in exactly the same way, but in addition, also provides `lockVip` and `runVip` methods to *skip the line* to the very front as a "VIP" task.

VIP tasks will still have to line up behind _other_ VIP tasks, and they will all execute in order, once the current mutex-holder finishes.

### Design Challenges

If you look at the implementation for `VipMutex`, you'll notice it is considerable more complicated than the basic `Mutex`. In fact, it even uses two, not one, but _two_ extra Mutexes within itself!


