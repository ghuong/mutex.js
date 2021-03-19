# Mutex.js

## About

This is a Promise-based Mutex implementation for preventing race conditions in concurrent (but non-parallel) programs in Node.js.

The twist is that it provides the option for a task to "skip the line" waiting for the mutex, jumping to the very front as a "VIP" task. See later section `vipMutex.js`.

### Are Race Conditions Possible in Node.js?

Yes.

Even though Node.js is single-threaded, race conditions are still possible if there are concurrent tasks reading and writing to the same shared resource.

For instance, two asynchronous tasks A and B may attempt to read from an account balance (say, $0), and then increment it, each by $50. The correct resulting balance should be $100. But what if, in a single-threaded environment, the order of operations happened to be like so:

```
A: Read Balance from DB: $0;

A: Calculate 0 + 50 = 50; --> Context-Switch!

B: Read Balance from DB: $0; (stale read) --> Context-Switch!

A: Write Balance to DB: $50; (Updated!) --> Context-Switch!

B: Calculate 0 + 50 = 50; (based on stale value)

B: Write Balance to DB: $50; (overwrite A's update)
```

In this case, the resulting erroneous balance is $50 because both tasks were racing to read/write to the same resource.

One solution is to protect the _critical path_, i.e. the parts of code that read/write to shared resources, so that only one task can execute there at a time. This would render that code "mutually exclusive".

Enter:

## `Mutex.js`

### Getting Started

Run `main.js` to demonstrate two examples with and without the use of a mutex:

```bash
node main.js
```

Run the code in [JS Bin](https://jsbin.com/salaqalaka/1/edit?js,console):

<a class="jsbin-embed" href="https://jsbin.com/salaqalaka/1/embed?js,console">JS Bin on jsbin.com</a><script src="https://static.jsbin.com/js/embed.min.js?4.1.8"></script>

## Usage

To use the basic mutex in `mutex.js`:

```js
const mutex = makeMutex(); // instantiate

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

_Note:_ Use a finally-block to ensure `unlock()` always gets called, even if the try-block throws an error. Failure to call `unlock()` will cause all tasks waiting for the mutex to wait forever!

### `.run()`

For this reason, the `.run()` function is also provided which just wraps your code with the `.lock()` / `unlock()` calls and `try-finally` blocks. Wrap any non-safe function to protect it:

```js
function unsafe() { etc. }

const safe = async () => await mutex.run(unsafe);

async function main() { await safe(); await safe(); }
// async function main() { await unsafe(); await unsafe(); }
```

Or, if your function takes arguments, use rest / spread syntax to pass them in:

```js
const safe = async (...args) => await mutex.run(unsafe, ...args);
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

**Short answer**: The waiting queue is just a Promise chain. Each task requesting mutex access just chains another promise (representing their lock) onto the end with `.then()`. They will get to go once the previous Promise is resolved. At the very beginning, the Promise chain starts off with an already resolved (not locked) dummy Promise.

**Longer answer**: In addition to chaining a promise / lock, the caller gets back a "key" or "unlock" function which simply calls the "resolve" function of their lock (thus, unlocking it). When the caller is done with the mutex, they call their `unlock()` function, which allows the next promise in the Promise chain to go.

**Long answer**: In order for tasks to block while the mutex is in use, they `await` on their `.lock()` call, which actually doesn't return the "unlock" function directly, but returns a _Promise_ of the unlock function, which resolves once the previous lock in the Promise chain resolves. This means the Promise chain is actually alternating between locks and keys:

```js
const keyTaskA, keyTaskB, keyTaskC, keyTaskD; // etc...
const lockTaskA = new Promise((resolve) => (keyTaskA = resolve));
lockTaskA.then(keyTaskB);
const lockTaskB = new Promise((resolve) => (keyTaskB = resolve));
lockTaskB.then(keyTaskC);
const lockTaskC = new Promise((resolve) => (keyTaskC = resolve));
lockTaskC.then(keyTaskD);
// etc...
```

The above "code" is meant to illustrate how the Promise chain is structured.

A's key unlocks A's lock. B's key unlocks B's lock. etc...

B's key is chained after A's lock. C's key is chained after B's lock. etc...

Here's an example in actual usage:

```js
// Task B:
const unlock = await mutex.lock(); // Task B is waiting for its key, which will resolve once Task A's lock is resolved
// ...
unlock(); // this resolves B's lock, which in turn resolves Task C's key

// Task C:
const unlock = await mutex.lock(); // waiting for B's lock
// etc...
```

## `vipMutex.js`

The function `makeVipMutex()`, from `vipMutex.js` can be used in exactly the same way, but in addition, also provides `.lockVip()` and `.runVip()` methods to _skip the line_ to the very front as a "VIP" task.

VIP tasks will still have to line up behind _other_ VIP tasks, and they will all execute in order, once the current mutex-holder finishes.

```js
const mutex = makeVipMutex();

const safe = async () => await mutex.runVip(unsafe);
```

### Interesting Design Challenges

If you look at the implementation for `vipMutex.js`, you'll notice it is _considerably_ more complicated than the basic `mutex.js`. In fact, it even contains a mutex in its mutex!

**Cancellable Promises: A Failed First Attempt**

Another challenge faced, involved an unfortunate detour, a first attempt at implementing VIP tasks. I had initially attempted to "re-wire" the Promise chain and tack VIP tasks onto the beginning of it, re-wiring the `.then()` relationships, hijacking the `reject` method of the Promises to cancel out the existing Promise chain, but none of it worked. It turned out that Promises are immutable, and trying to hack them to be mutable was not the right strategy.

**Back on Track: Two Promise Chains!**

Later, I took a different approach that actually worked. The gist of it is that instead of just the one Promise chain (previously described), now there are two: one for normal tasks, and one for VIPs. The normal chain is exactly like before. The VIP chain, however, begins with a dummy locked Promise, which can only be unlocked by the mutex-holder.

When the mutex-holder calls `unlock()`, it first checks for VIP tasks to let them go first, before resolving its lock to let the next non-VIP task go. It does this by unlocking the first dummy VIP in line, and then `await`ing on the last VIP in line (thereby "emptying" the VIP Promise chain).

Now, the major design challenge involved a potential race condition within the mutex itself! Hence, that is why it needed its own mutex to prevent this.

The potential race condition was if, while the VIP queue is being emptied, another new VIP task were to line up, the `unlock()` code above would not know to wait for it. Once the "last" VIP resolves (which unblocks the newly arrived VIP on the chain), the `unlock()` code would unblock the next-in-line non-VIP task, leading to a race, and breaking mutual exclusion.

For more details, the code contains extensive comments, which will not be re-iterated here.
