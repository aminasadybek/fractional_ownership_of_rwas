// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title AssetToken
/// @notice A minimal ERC-721 that stands in for the on-chain title of a
///         real-world asset (for example a building or a painting).
///         One token = one physical asset. Only the issuer (owner) can mint,
///         which models a registrar or custodian vouching for the asset.
contract AssetToken is ERC721, Ownable {
    uint256 private _nextId;

    constructor(address issuer) ERC721("Real World Asset Title", "RWA") Ownable(issuer) {}

    /// @notice Mint a new asset title to `to`. Returns the new token id.
    function mint(address to) external onlyOwner returns (uint256 tokenId) {
        tokenId = _nextId++;
        _mint(to, tokenId);
    }
}
