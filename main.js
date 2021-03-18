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
const safeSell = async (name, ...args) => await mutex.run(_sell, name, ...args);

// const sellMeFirst = async (name, ...args) => await mutex.runPriority(_sell, name, ...args);

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
