// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/// @title FractionalVault
/// @notice Baseline fractional ownership: one vault locks one ERC-721 asset
///         and issues a fixed supply of ERC-20 shares against it.
///
///         Lifecycle:
///           1. Empty      - deployed, no asset yet
///           2. Active     - asset locked, shares in circulation and freely transferable
///           3. Redeemed   - someone holding 100% of the shares burned them and took the asset
///
///         This is the baseline the project's prototype (governance, exit/liquidity
///         or dispute resolution) is compared against. It deliberately has no
///         mechanism for minority owners: the only way out is to collect every share.
contract FractionalVault is ERC20 {
    enum State {
        Empty,
        Active,
        Redeemed
    }

    State public state;
    IERC721 public asset;
    uint256 public assetId;

    event Fractionalized(address indexed owner, address indexed asset, uint256 indexed assetId, uint256 shares);
    event Redeemed(address indexed redeemer, address indexed asset, uint256 indexed assetId);

    error WrongState(State expected, State actual);
    error ZeroShares();
    error NotAllShares(uint256 held, uint256 total);

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    /// @notice Lock `tokenId` of `nft` in the vault and mint `totalShares` to the caller.
    /// @dev The caller must first approve this vault for the token (approve or setApprovalForAll).
    function fractionalize(IERC721 nft, uint256 tokenId, uint256 totalShares) external {
        if (state != State.Empty) revert WrongState(State.Empty, state);
        if (totalShares == 0) revert ZeroShares();

        // Effects before the external call (checks-effects-interactions).
        state = State.Active;
        asset = nft;
        assetId = tokenId;

        nft.transferFrom(msg.sender, address(this), tokenId);
        _mint(msg.sender, totalShares);

        emit Fractionalized(msg.sender, address(nft), tokenId, totalShares);
    }

    /// @notice Burn 100% of the shares and receive the underlying asset.
    function redeem() external {
        if (state != State.Active) revert WrongState(State.Active, state);
        uint256 total = totalSupply();
        uint256 held = balanceOf(msg.sender);
        if (held != total) revert NotAllShares(held, total);

        state = State.Redeemed;
        _burn(msg.sender, held);

        asset.transferFrom(address(this), msg.sender, assetId);

        emit Redeemed(msg.sender, address(asset), assetId);
    }
}
