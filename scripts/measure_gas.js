// Measures gas for the baseline FractionalVault on the local Hardhat network.
//
// Outputs (overwritten on every run):
//   data/gas_operations.csv     gas per single operation
//   data/exit_cost_vs_owners.csv gas for one buyer to re-collect all shares
//                                from N owners and redeem the asset
//   data/gas_run_metadata.json  versions, settings and date of the run
//
// Run:  npx hardhat run scripts/measure_gas.js
//
// Everything is deterministic: Hardhat's default accounts come from a fixed
// mnemonic, the extra owner wallets are derived from that same mnemonic,
// and share amounts are fixed. No random numbers are used.

const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { ethers } = hre;

const TOTAL_SHARES = ethers.parseUnits("1000", 18);
const OWNER_COUNTS = [1, 2, 5, 10, 20, 50, 100];
const DATA_DIR = path.join(__dirname, "..", "data");

// Hardhat's built-in development mnemonic (public, for local testing only).
const MNEMONIC = "test test test test test test test test test test test junk";

async function gasOf(txPromise) {
  const tx = await txPromise;
  const receipt = await tx.wait();
  return receipt.gasUsed;
}

// Derives `n` deterministic wallets (offset past the 20 default accounts) and funds them.
async function makeOwners(n, funder) {
  const owners = [];
  for (let i = 0; i < n; i++) {
    const w = ethers.HDNodeWallet.fromPhrase(MNEMONIC, undefined, `m/44'/60'/0'/0/${100 + i}`).connect(ethers.provider);
    owners.push(w);
  }
  for (const w of owners) {
    await (await funder.sendTransaction({ to: w.address, value: ethers.parseEther("1") })).wait();
  }
  return owners;
}

async function deployActiveVault(issuer, holder) {
  const assetToken = await (await ethers.getContractFactory("AssetToken")).deploy(issuer.address);
  await (await assetToken.connect(issuer).mint(holder.address)).wait();

  const vault = await (await ethers.getContractFactory("FractionalVault")).deploy("Asset Shares", "SHR");
  await (await assetToken.connect(holder).approve(await vault.getAddress(), 0)).wait();
  await (await vault.connect(holder).fractionalize(await assetToken.getAddress(), 0, TOTAL_SHARES)).wait();
  return { assetToken, vault };
}

async function measureOperations(issuer, alice, bob) {
  const rows = [];

  const assetToken = await (await ethers.getContractFactory("AssetToken")).deploy(issuer.address);
  rows.push(["deploy_asset_token", (await assetToken.deploymentTransaction().wait()).gasUsed]);

  rows.push(["mint_asset", await gasOf(assetToken.connect(issuer).mint(alice.address))]);

  const vault = await (await ethers.getContractFactory("FractionalVault")).deploy("Asset Shares", "SHR");
  rows.push(["deploy_vault", (await vault.deploymentTransaction().wait()).gasUsed]);

  rows.push(["approve_asset", await gasOf(assetToken.connect(alice).approve(await vault.getAddress(), 0))]);
  rows.push([
    "fractionalize",
    await gasOf(vault.connect(alice).fractionalize(await assetToken.getAddress(), 0, TOTAL_SHARES)),
  ]);

  const half = TOTAL_SHARES / 2n;
  rows.push(["transfer_shares_new_holder", await gasOf(vault.connect(alice).transfer(bob.address, half))]);
  rows.push(["transfer_shares_existing_holder", await gasOf(vault.connect(alice).transfer(bob.address, half / 2n))]);

  // Collect everything back to Alice, then redeem.
  await (await vault.connect(bob).transfer(alice.address, await vault.balanceOf(bob.address))).wait();
  rows.push(["redeem", await gasOf(vault.connect(alice).redeem())]);

  return rows;
}

// Exit cost: shares are split equally across N owners; a single buyer must
// receive a transfer from each of them and then call redeem().
async function measureExitCost(issuer, buyer, funder) {
  const rows = [];
  for (const n of OWNER_COUNTS) {
    const owners = await makeOwners(n, funder);
    const { vault } = await deployActiveVault(issuer, owners[0]);

    // Distribute shares equally (owner 0 keeps the remainder).
    const each = TOTAL_SHARES / BigInt(n);
    for (let i = 1; i < n; i++) {
      await (await vault.connect(owners[0]).transfer(owners[i].address, each)).wait();
    }

    // Every owner sends their shares to the buyer.
    let transferGas = 0n;
    for (const o of owners) {
      transferGas += await gasOf(vault.connect(o).transfer(buyer.address, await vault.balanceOf(o.address)));
    }
    const redeemGas = await gasOf(vault.connect(buyer).redeem());

    rows.push([n, transferGas, redeemGas, transferGas + redeemGas]);
    console.log(`owners=${n}  transfers=${transferGas}  redeem=${redeemGas}  total=${transferGas + redeemGas}`);
  }
  return rows;
}

function writeCsv(file, header, rows) {
  const lines = [header.join(","), ...rows.map((r) => r.map(String).join(","))];
  fs.writeFileSync(path.join(DATA_DIR, file), lines.join("\n") + "\n");
}

async function main() {
  if (hre.network.name !== "hardhat") {
    throw new Error("Run on the local hardhat network so results are reproducible.");
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const [issuer, alice, bob, buyer, funder] = await ethers.getSigners();

  const ops = await measureOperations(issuer, alice, bob);
  writeCsv("gas_operations.csv", ["operation", "gas_used"], ops);
  console.table(ops.map(([operation, gas]) => ({ operation, gas: gas.toString() })));

  const exit = await measureExitCost(issuer, buyer, funder);
  writeCsv("exit_cost_vs_owners.csv", ["owners", "transfer_gas_total", "redeem_gas", "total_gas"], exit);

  const solc = hre.config.solidity.compilers[0];
  const metadata = {
    date_utc: new Date().toISOString(),
    network: hre.network.name,
    hardhat_version: require("hardhat/package.json").version,
    openzeppelin_version: require("@openzeppelin/contracts/package.json").version,
    solc_version: solc.version,
    optimizer: solc.settings.optimizer,
    evm_version: solc.settings.evmVersion,
    node_version: process.version,
    total_shares: TOTAL_SHARES.toString(),
    owner_counts: OWNER_COUNTS,
  };
  fs.writeFileSync(path.join(DATA_DIR, "gas_run_metadata.json"), JSON.stringify(metadata, null, 2) + "\n");
  console.log("Wrote data/gas_operations.csv, data/exit_cost_vs_owners.csv, data/gas_run_metadata.json");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
