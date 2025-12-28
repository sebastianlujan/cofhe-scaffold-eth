// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";

/// @title IEVVMSignedTransfers - Interface for EIP-191 Signed Transfers
/// @notice Interface for cryptographically signed transfer operations
/// @dev Extends core functionality with EIP-191 signature validation
interface IEVVMSignedTransfers {
    // ============ Structs ============

    /// @notice EIP-191 signature components for transaction authorization
    struct Signature {
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    // ============ Events ============

    /// @notice Emitted when a signed transfer is applied
    event SignedTransferApplied(
        bytes32 indexed fromVaddr,
        bytes32 indexed toVaddr,
        address indexed signer,
        uint64 nonce,
        uint256 deadline,
        uint256 txId
    );

    // ============ Constants ============

    /// @notice Domain identifier for EVVM signatures
    function EVVM_DOMAIN() external view returns (bytes32);

    /// @notice Signature scheme version
    function SIGNATURE_VERSION() external view returns (uint8);

    // ============ Message Hash Functions ============

    /// @notice Creates the message hash for a signed transfer operation
    /// @param fromVaddr Source virtual address
    /// @param toVaddr Destination virtual address
    /// @param amountCommitment Commitment to encrypted amount (hash of ciphertext handle)
    /// @param nonce Transaction nonce
    /// @param deadline Expiration timestamp
    /// @return messageHash The hash to be signed
    function getTransferMessageHash(
        bytes32 fromVaddr,
        bytes32 toVaddr,
        bytes32 amountCommitment,
        uint64 nonce,
        uint256 deadline
    ) external view returns (bytes32);

    // ============ Signed Transfer Functions ============

    /// @notice Applies a signed transfer within the virtual blockchain
    /// @dev Requires valid EIP-191 signature from the account owner
    /// @param fromVaddr Source virtual account
    /// @param toVaddr Destination virtual account
    /// @param amount Encrypted amount (externalEuint64)
    /// @param inputProof ZK proof for encrypted input
    /// @param expectedNonce Nonce for replay protection
    /// @param deadline Timestamp after which signature expires
    /// @param sig EIP-191 signature from the account owner
    /// @return txId Transaction ID
    function applySignedTransfer(
        bytes32 fromVaddr,
        bytes32 toVaddr,
        externalEuint64 amount,
        bytes calldata inputProof,
        uint64 expectedNonce,
        uint256 deadline,
        Signature calldata sig
    ) external returns (uint256 txId);

    /// @notice Applies a signed transfer using Ethereum addresses
    /// @dev Requires valid EIP-191 signature from the sender
    /// @param from Source Ethereum address
    /// @param to Destination Ethereum address
    /// @param amount Encrypted amount (externalEuint64)
    /// @param inputProof ZK proof for encrypted input
    /// @param expectedNonce Nonce for replay protection
    /// @param deadline Timestamp after which signature expires
    /// @param sig EIP-191 signature from the sender
    /// @return txId Transaction ID
    function requestPaySigned(
        address from,
        address to,
        externalEuint64 amount,
        bytes calldata inputProof,
        uint64 expectedNonce,
        uint256 deadline,
        Signature calldata sig
    ) external returns (uint256 txId);
}
