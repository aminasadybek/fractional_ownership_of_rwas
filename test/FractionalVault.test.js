const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const TOTAL_SHARES = ethers.parseUnits("1000", 18);

describe("FractionalVault", function () {
  async function deployFixture() {
    const [issuer, alice, bob] = await ethers.getSigners();

    const AssetToken = await ethers.getContractFactory("AssetToken");
    const assetToken = await AssetToken.deploy(issuer.address);

    // Alice owns asset #0.
    await assetToken.connect(issuer).mint(alice.address);

    const Vault = await ethers.getContractFactory("FractionalVault");
    const vault = await Vault.deploy("Building Shares", "BLDG");

    return { assetToken, vault, issuer, alice, bob };
  }

  async function activeFixture() {
    const f = await deployFixture();
    await f.assetToken.connect(f.alice).approve(await f.vault.getAddress(), 0);
    await f.vault.connect(f.alice).fractionalize(await f.assetToken.getAddress(), 0, TOTAL_SHARES);
    return f;
  }

  describe("fractionalize", function () {
    it("locks the asset and mints all shares to the owner", async function () {
      const { assetToken, vault, alice } = await loadFixture(activeFixture);

      expect(await assetToken.ownerOf(0)).to.equal(await vault.getAddress());
      expect(await vault.balanceOf(alice.address)).to.equal(TOTAL_SHARES);
      expect(await vault.totalSupply()).to.equal(TOTAL_SHARES);
      expect(await vault.state()).to.equal(1); // Active
    });

    it("emits Fractionalized", async function () {
      const { assetToken, vault, alice } = await loadFixture(deployFixture);
      await assetToken.connect(alice).approve(await vault.getAddress(), 0);

      await expect(vault.connect(alice).fractionalize(await assetToken.getAddress(), 0, TOTAL_SHARES))
        .to.emit(vault, "Fractionalized")
        .withArgs(alice.address, await assetToken.getAddress(), 0, TOTAL_SHARES);
    });

    it("rejects zero shares", async function () {
      const { assetToken, vault, alice } = await loadFixture(deployFixture);
      await assetToken.connect(alice).approve(await vault.getAddress(), 0);

      await expect(
        vault.connect(alice).fractionalize(await assetToken.getAddress(), 0, 0)
      ).to.be.revertedWithCustomError(vault, "ZeroShares");
    });

    it("cannot be called twice", async function () {
      const { assetToken, vault, alice } = await loadFixture(activeFixture);

      await expect(
        vault.connect(alice).fractionalize(await assetToken.getAddress(), 0, TOTAL_SHARES)
      ).to.be.revertedWithCustomError(vault, "WrongState");
    });

    it("fails if the caller does not own the asset", async function () {
      const { assetToken, vault, bob } = await loadFixture(deployFixture);

      await expect(vault.connect(bob).fractionalize(await assetToken.getAddress(), 0, TOTAL_SHARES)).to.be.reverted;
    });
  });

  describe("redeem", function () {
    it("lets a holder of 100% of shares take the asset back", async function () {
      const { assetToken, vault, alice } = await loadFixture(activeFixture);

      await expect(vault.connect(alice).redeem()).to.emit(vault, "Redeemed");

      expect(await assetToken.ownerOf(0)).to.equal(alice.address);
      expect(await vault.totalSupply()).to.equal(0);
      expect(await vault.state()).to.equal(2); // Redeemed
    });

    it("blocks redemption while shares are split between owners", async function () {
      const { vault, alice, bob } = await loadFixture(activeFixture);
      const toBob = ethers.parseUnits("1", 18);
      await vault.connect(alice).transfer(bob.address, toBob);

      await expect(vault.connect(alice).redeem())
        .to.be.revertedWithCustomError(vault, "NotAllShares")
        .withArgs(TOTAL_SHARES - toBob, TOTAL_SHARES);
    });

    it("works after shares are re-collected by one owner", async function () {
      const { assetToken, vault, alice, bob } = await loadFixture(activeFixture);
      await vault.connect(alice).transfer(bob.address, ethers.parseUnits("400", 18));
      await vault.connect(alice).transfer(bob.address, ethers.parseUnits("600", 18));

      await vault.connect(bob).redeem();
      expect(await assetToken.ownerOf(0)).to.equal(bob.address);
    });

    it("cannot be called before fractionalize", async function () {
      const { vault, alice } = await loadFixture(deployFixture);
      await expect(vault.connect(alice).redeem()).to.be.revertedWithCustomError(vault, "WrongState");
    });
  });
});
