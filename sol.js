const web3 = require("@solana/web3.js");
(async () => {
  const solana = new web3.Connection("https://little-blue-road.solana-devnet.quiknode.pro/1a5408432a7b3e59f40d2b1471e0a3fa4ae9ac25/");
  console.log(await solana.getSlot());
})();