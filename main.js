const PriorityMutex = require("./priorityMutex");

const randomDelay = () =>
  new Promise((resolve) => setTimeout(resolve, Math.random() * 100));

let balance = 0; // global balance
const mutex = new PriorityMutex();

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
 * ! Vulnerable to race conditions!
 * @param {String} product name of product
 */
const _unsafeSell = async (product) => {
  const balance = await loadBalance();
  console.log(`sell ${product} - balance loaded: ${balance}`);
  const newBalance = balance + 50;
  await saveBalance(newBalance);
  console.log(`sell ${product} - balance updated: ${newBalance}`);
};

// wrap sell function in mutex lock:
const safeSell = async (...args) => await mutex.run(_unsafeSell, ...args);

// this one will skip the line
const sellMeFirst = async (...args) => await mutex.runVip(_unsafeSell, ...args);

const main = async () => {
  await Promise.all([
    safeSell("grapes"), // first to sell
    safeSell("olives"),
    safeSell("rice"),
    safeSell("beans"),
    safeSell("potatoes"),
    sellMeFirst("diamonds"), // second to sell
    sellMeFirst("rubies"), // third
    sellMeFirst("sapphires"), // fourth
  ]);
  // expect to sell grapes->diamonds->rubies->sapphires->olives->etc.
  const balance = await loadBalance();
  console.log(`Final balance: $${balance}`); // should be $400
};

main();
