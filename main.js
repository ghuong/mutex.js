const VipMutex = require("./vipMutex");

const randomDelay = () =>
  new Promise((resolve) => setTimeout(resolve, Math.random() * 100));

let balance = 0; // global balance
const mutex = new VipMutex();

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
const vipSell = async (...args) => await mutex.runVip(_unsafeSell, ...args);

const main = async () => {
  console.log("This is what happens when you don't use a mutex:\n");
  console.log(`Starting balance: $${balance}\n`);
  await Promise.all([
    _unsafeSell("grapes"),
    _unsafeSell("olives"),
    _unsafeSell("rice"),
    _unsafeSell("beans"),
    _unsafeSell("potatoes"),
    _unsafeSell("carrots"),
  ]);
  // currentBalance = await loadBalance();
  console.log(`\nFinal balance: $${balance}`); // should be $400, but might be less
  console.log(`Expected balance: $300`);

  balance = 0; // reset balance

  console.log("\nNow with a mutex:\n");
  console.log(`Starting balance: $${balance}\n`);
  await Promise.all([
    safeSell("grapes"), // first to sell
    safeSell("olives"),
    safeSell("rice"),
    safeSell("beans"),
    vipSell("diamonds"), // second to sell
    vipSell("rubies"), // third
  ]);
  // expect to sell grapes->diamonds->rubies->sapphires->olives->etc.
  // const balance = await loadBalance();
  console.log(`\nFinal balance: $${balance}`); // should be $300
  console.log(`Expected balance: $300`);
};

main();
