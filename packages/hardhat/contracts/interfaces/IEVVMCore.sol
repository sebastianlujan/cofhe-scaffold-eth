// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";

/// @title IEVVMCore - Core Interface for EVVM Virtual Blockchain
/// @notice Minimal interface for virtual account management and basic transfers
/// @dev This interface defines the core functionality without signature or secure transfer features
interface IEVVMCore {
    // ============ Structs ============

    /// @notice Represents an account within the virtual blockchain
    struct VirtualAccount {
        euint64 balance;      // Encrypted balance of the principal token
        uint64 nonce;         // Transaction counter from this account (public for replay protection)
        bool exists;          // Existence flag
    }

    /// @notice Represents a virtual transaction in the blockchain
    struct VirtualTransaction {
        bytes32 fromVaddr;    // Source virtual account
        bytes32 toVaddr;      // Destination virtual account
        euint64 amountEnc;    // Encrypted amount transferred
        uint64 nonce;         // Nonce used in this transaction
        uint64 vBlockNumber;  // Virtual block number when transaction was applied
        uint256 timestamp;    // Block timestamp when transaction was applied
        bool exists;          // Existence flag
    }

    /// @notice Represents a virtual block in the blockchain
    struct VirtualBlock {
        uint64 blockNumber;      // Block number
        bytes32 stateCommitment; // State commitment at this block
        uint256 timestamp;       // Block timestamp
        uint256 transactionCount; // Number of transactions in this block
        bool exists;             // Existence flag
    }

    /// @notice Parameters for a batch transfer operation
    struct TransferParams {
        bytes32 fromVaddr;       // Source virtual account
        bytes32 toVaddr;         // Destination virtual account
        externalEuint64 amount;  // Encrypted amount handle (external input)
        bytes inputProof;        // ZK proof for the encrypted input
        uint64 expectedNonce;    // Expected nonce for the source account
    }

    // ============ Events ============

    /// @notice Emitted when a new virtual account is registered
    event VirtualAccountRegistered(bytes32 indexed vaddr, uint64 initialNonce);

    /// @notice Emitted when a virtual transaction is applied
    event VirtualTransferApplied(
        bytes32 indexed fromVaddr,
        bytes32 indexed toVaddr,
        euint64 amountEnc,
        uint64 nonce,
        uint64 vBlockNumber,
        uint256 txId
    );

    /// @notice Emitted when a new virtual block is created
    event VirtualBlockCreated(uint64 indexed blockNumber, bytes32 stateCommitment, uint256 timestamp);

    /// @notice Emitted when state commitment is updated
    event StateCommitmentUpdated(bytes32 indexed oldCommitment, bytes32 indexed newCommitment, uint64 vBlockNumber);

    // ============ Account Management ============

    /// @notice Registers a new virtual account
    /// @param vaddr The virtual address for the account
    /// @param initialBalance Encrypted initial balance
    /// @param inputProof ZK proof for the encrypted input
    function registerAccount(
        bytes32 vaddr,
        externalEuint64 initialBalance,
        bytes calldata inputProof
    ) external;

    /// @notice Registers a new virtual account using an Ethereum address
    /// @param realAddress The Ethereum address to register
    /// @param initialBalance Encrypted initial balance
    /// @param inputProof ZK proof for the encrypted input
    function registerAccountFromAddress(
        address realAddress,
        externalEuint64 initialBalance,
        bytes calldata inputProof
    ) external;

    /// @notice Checks if a virtual account exists
    /// @param vaddr The virtual address to check
    /// @return exists True if the account exists
    function accountExists(bytes32 vaddr) external view returns (bool);

    /// @notice Gets the encrypted balance of a virtual account
    /// @param vaddr The virtual address to query
    /// @return balance The encrypted balance handle
    function getEncryptedBalance(bytes32 vaddr) external view returns (euint64);

    /// @notice Gets the nonce of a virtual account
    /// @param vaddr The virtual address to query
    /// @return nonce The current nonce
    function getNonce(bytes32 vaddr) external view returns (uint64);

    /// @notice Gets full account information
    /// @param vaddr The virtual address to query
    /// @return account The VirtualAccount struct
    function getAccount(bytes32 vaddr) external view returns (VirtualAccount memory);

    // ============ Address Mapping ============

    /// @notice Gets the virtual address for an Ethereum address
    /// @param realAddress The Ethereum address to query
    /// @return vaddr The virtual address (bytes32(0) if not registered)
    function getVaddrFromAddress(address realAddress) external view returns (bytes32);

    /// @notice Generates a deterministic vaddr from an address and salt
    /// @param realAddress The Ethereum address
    /// @param salt Additional salt for uniqueness
    /// @return vaddr The generated virtual address
    function generateVaddrFromAddress(address realAddress, bytes32 salt) external view returns (bytes32);

    // ============ Basic Transfers ============

    /// @notice Applies a transfer between virtual accounts
    /// @param fromVaddr Source virtual address
    /// @param toVaddr Destination virtual address
    /// @param amount Encrypted amount to transfer
    /// @param inputProof ZK proof for the encrypted input
    /// @param expectedNonce Expected nonce for replay protection
    /// @return txId The transaction ID
    function applyTransfer(
        bytes32 fromVaddr,
        bytes32 toVaddr,
        externalEuint64 amount,
        bytes calldata inputProof,
        uint64 expectedNonce
    ) external returns (uint256 txId);

    /// @notice Applies a transfer using Ethereum addresses
    /// @param from Source Ethereum address
    /// @param to Destination Ethereum address
    /// @param amount Encrypted amount to transfer
    /// @param inputProof ZK proof for the encrypted input
    /// @param expectedNonce Expected nonce for replay protection
    /// @return txId The transaction ID
    function requestPay(
        address from,
        address to,
        externalEuint64 amount,
        bytes calldata inputProof,
        uint64 expectedNonce
    ) external returns (uint256 txId);

    /// @notice Applies multiple transfers in a batch
    /// @param transfers Array of transfer parameters
    /// @return successfulTxs Number of successful transfers
    /// @return failedTxs Number of failed transfers
    /// @return txIds Array of transaction IDs (0 for failed)
    function applyTransferBatch(TransferParams[] calldata transfers)
        external
        returns (uint256 successfulTxs, uint256 failedTxs, uint256[] memory txIds);

    // ============ Transaction Queries ============

    /// @notice Gets a virtual transaction by ID
    /// @param txId The transaction ID
    /// @return tx The VirtualTransaction struct
    function getVirtualTransaction(uint256 txId) external view returns (VirtualTransaction memory);

    // ============ Block Management ============

    /// @notice Gets block information
    /// @param blockNumber The block number to query
    /// @return blockInfo The VirtualBlock struct
    function getBlockInfo(uint64 blockNumber) external view returns (VirtualBlock memory);

    /// @notice Creates a new virtual block with state commitment
    /// @param newCommitment The state commitment for the new block
    /// @return blockNumber The new block number
    function createVirtualBlock(bytes32 newCommitment) external returns (uint64 blockNumber);

    /// @notice Updates the state commitment
    /// @param newCommitment The new state commitment
    function updateStateCommitment(bytes32 newCommitment) external;

    // ============ View Functions ============

    /// @notice Gets the current virtual block number
    function vBlockNumber() external view returns (uint64);

    /// @notice Gets the virtual chain ID
    function vChainId() external view returns (uint64);

    /// @notice Gets the EVVM instance ID
    function evvmID() external view returns (uint256);

    /// @notice Gets the current state commitment
    function stateCommitment() external view returns (bytes32);
}
