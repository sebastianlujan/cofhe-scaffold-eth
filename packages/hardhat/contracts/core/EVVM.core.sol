// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, externalEuint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

// Periphery library for signature verification
import {EVVMSignatureVerifier} from "../periphery/EVVMSignatureVerifier.sol";


/// @title EVVM Core - Virtual Blockchain with FHE
/// @notice MVP of EVVM Core as "virtual blockchain" using FHE for private balances
/// @dev Phase 4A: Architecture refactored with periphery libraries
/// 
/// @dev This contract implements a minimal virtual blockchain with the following features:
/// - Virtual accounts with encrypted balances (euint64)
/// - Virtual transactions with nonce-based replay protection
/// - Virtual block progression with state commitments
/// - Batch transfer processing
/// - EIP-191 signed transfers
/// - Plan 2A secure transfers with FHE secrets
/// - Admin functions for testing and maintenance
///
/// @dev Architecture:
/// - Core functionality for accounts, transfers, and blocks
/// - Uses EVVMSignatureVerifier library for signature operations
/// - Interfaces defined in contracts/interfaces/ for external reference
///
/// @dev Usage Flow:
/// 1. Deploy contract with vChainId and evvmID
/// 2. Users register accounts with encrypted initial balances
/// 3. Users perform transfers using encrypted amounts
/// 4. State commitments are calculated off-chain and submitted on-chain
/// 5. Virtual blocks track transaction history
///
/// @notice Migrated from Fhenix CoFHE to Zama FHEVM
/// @notice Phase 2: EIP-191 signature validation added
/// @notice Phase 2A: Plan 2A challenge-response authentication added
contract EVVMCore is Ownable, ZamaEthereumConfig {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ============ Structs ============
    
    /// @notice EIP-191 signature components for transaction authorization
    struct Signature {
        uint8 v;
        bytes32 r;
        bytes32 s;
    }
    
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
    
    /// @notice Parameters for a batch transfer operation
    struct TransferParams {
        bytes32 fromVaddr;    // Source virtual account
        bytes32 toVaddr;      // Destination virtual account
        externalEuint64 amount;  // Encrypted amount handle (external input)
        bytes inputProof;     // ZK proof for the encrypted input
        uint64 expectedNonce; // Expected nonce for the source account
    }
    
    /// @notice Represents a virtual block in the blockchain
    struct VirtualBlock {
        uint64 blockNumber;   // Block number
        bytes32 stateCommitment; // State commitment at this block
        uint256 timestamp;     // Block timestamp
        uint256 transactionCount; // Number of transactions in this block
        bool exists;           // Existence flag
    }
    
    /// @notice Pending secure transfer challenge for two-phase FHE authentication
    /// @dev Phase A creates this challenge, Phase B completes it with secret verification
    struct SecureTransferChallenge {
        bytes32 fromVaddr;           // Source account
        bytes32 toVaddr;             // Destination account
        externalEuint64 amount;      // Encrypted amount handle
        bytes inputProof;            // ZK proof for amount
        uint64 expectedNonce;        // Nonce at time of request
        uint256 deadline;            // Signature deadline
        uint256 challengeExpiry;     // Challenge expiration timestamp
        bytes32 challengeHash;       // Random challenge for binding
        bool exists;                 // Existence flag
    }

    // ============ State Variables ============
    
    /// @notice Virtual chain ID (immutable)
    uint64 public immutable vChainId;
    
    /// @notice Current height of the "virtual blockchain"
    uint64 public vBlockNumber;
    
    /// @notice EVVM ID for future signature verification
    uint256 public evvmID;
    
    /// @notice Cryptographic commitment to the current state of the virtual blockchain
    /// @dev This can be a Merkle root, hash of all account states, or any state commitment scheme
    bytes32 public stateCommitment;
    
    /// @notice Map of virtual addresses to accounts
    /// @dev vaddr is a pseudonymous identifier (e.g. keccak256(pubkey) or hash of real address)
    mapping(bytes32 => VirtualAccount) private accounts;
    
    /// @notice Map of transaction IDs to virtual transactions
    /// @dev txId is a unique identifier for each transaction
    mapping(uint256 => VirtualTransaction) public virtualTransactions;
    
    /// @notice Next transaction ID to be assigned
    /// @dev Starts at 1, increments for each new transaction
    uint256 public nextTxId;
    
    /// @notice Map of block numbers to virtual block information
    /// @dev Stores metadata about each virtual block
    mapping(uint64 => VirtualBlock) public virtualBlocks;
    
    /// @notice Map of Ethereum addresses to virtual addresses
    /// @dev Enables compatibility layer for traditional contracts
    mapping(address => bytes32) public addressToVaddr;
    
    /// @notice Map of virtual addresses to Ethereum addresses (reverse mapping)
    /// @dev Enables lookup of real address from virtual address
    mapping(bytes32 => address) public vaddrToAddress;
    
    // ============ FHE Hybrid Authentication (Plan 2A) ============
    
    /// @notice Map of challenge IDs to pending secure transfers
    /// @dev Phase A creates challenges, Phase B completes them
    mapping(bytes32 => SecureTransferChallenge) public pendingSecureTransfers;
    
    /// @notice Encrypted secrets for FHE authentication layer
    /// @dev Only the account owner knows the plaintext value
    mapping(bytes32 => euint64) private accountSecrets;
    
    /// @notice Flag to enable FHE secret requirement per account
    /// @dev When true, transfers require secret verification via challenge-response
    mapping(bytes32 => bool) public fheSecretEnabled;
    
    /// @notice Challenge expiration time (5 minutes)
    /// @dev User must complete Phase B within this time after Phase A
    uint256 public constant CHALLENGE_EXPIRY = 5 minutes;
    
    // ============ Signature Constants ============
    
    /// @notice Domain identifier for EVVM signatures (prevents cross-protocol replay)
    bytes32 public constant EVVM_DOMAIN = keccak256("EVVM Virtual Transaction");
    
    /// @notice Signature scheme version (allows future upgrades without breaking existing signatures)
    uint8 public constant SIGNATURE_VERSION = 1;
    
    // ============ Events ============
    
    /// @notice Emitted when a new virtual account is registered
    /// @param vaddr The virtual address of the registered account
    /// @param initialNonce The initial nonce (always 0 for new accounts)
    event VirtualAccountRegistered(
        bytes32 indexed vaddr,
        uint64 initialNonce
    );
    
    /// @notice Emitted when a virtual transaction is applied
    /// @param fromVaddr The source virtual address
    /// @param toVaddr The destination virtual address
    /// @param amountEnc The encrypted amount transferred
    /// @param nonce The nonce used in this transaction
    /// @param vBlockNumber The virtual block number when the transaction was applied
    /// @param txId The unique transaction ID
    event VirtualTransferApplied(
        bytes32 indexed fromVaddr,
        bytes32 indexed toVaddr,
        euint64 amountEnc,
        uint64 nonce,
        uint64 vBlockNumber,
        uint256 txId
    );
    
    /// @notice Emitted when the virtual state commitment is updated
    /// @param newCommitment The new state commitment (e.g., Merkle root)
    event StateCommitmentUpdated(bytes32 newCommitment);
    
    /// @notice Emitted when a virtual block is created
    /// @param vBlockNumber The virtual block number
    /// @param stateCommitment The state commitment for this block
    event VirtualBlockCreated(
        uint64 indexed vBlockNumber,
        bytes32 stateCommitment
    );
    
    /// @notice Emitted when the EVVM ID is updated
    /// @param oldEvvmID The previous EVVM ID
    /// @param newEvvmID The new EVVM ID
    event EvvmIDUpdated(uint256 oldEvvmID, uint256 newEvvmID);
    
    /// @notice Emitted when balance is added via faucet
    /// @param vaddr The virtual address that received the balance
    /// @param amountAdded The encrypted amount that was added
    event FaucetBalanceAdded(
        bytes32 indexed vaddr,
        euint64 amountAdded
    );
    
    /// @notice Emitted when an account is registered from an Ethereum address
    /// @param realAddress The Ethereum address that was registered
    /// @param vaddr The generated virtual address
    event AccountRegisteredFromAddress(
        address indexed realAddress,
        bytes32 indexed vaddr
    );
    
    /// @notice Emitted when a signed virtual transaction is applied
    /// @param fromVaddr The source virtual address
    /// @param toVaddr The destination virtual address
    /// @param signer The address that signed the transaction
    /// @param nonce The nonce used in this transaction
    /// @param deadline The deadline that was set for the signature
    /// @param txId The unique transaction ID
    event SignedTransferApplied(
        bytes32 indexed fromVaddr,
        bytes32 indexed toVaddr,
        address indexed signer,
        uint64 nonce,
        uint256 deadline,
        uint256 txId
    );
    
    // ============ Plan 2A Events (FHE Hybrid Auth) ============
    
    /// @notice Emitted when a secure transfer challenge is created (Phase A)
    /// @param challengeId Unique identifier for the challenge
    /// @param fromVaddr The source virtual address
    /// @param toVaddr The destination virtual address
    /// @param challengeExpiry Timestamp when challenge expires
    event SecureTransferRequested(
        bytes32 indexed challengeId,
        bytes32 indexed fromVaddr,
        bytes32 indexed toVaddr,
        uint256 challengeExpiry
    );
    
    /// @notice Emitted when a secure transfer is completed (Phase B)
    /// @param challengeId The challenge that was completed
    /// @param fromVaddr The source virtual address
    /// @param toVaddr The destination virtual address
    /// @param nonce The nonce used in this transaction
    /// @param txId The unique transaction ID
    event SecureTransferCompleted(
        bytes32 indexed challengeId,
        bytes32 indexed fromVaddr,
        bytes32 indexed toVaddr,
        uint64 nonce,
        uint256 txId
    );
    
    /// @notice Emitted when a secure transfer challenge is cancelled or expires
    /// @param challengeId The challenge that was cancelled
    /// @param fromVaddr The source virtual address
    /// @param reason The reason for cancellation ("expired" or "cancelled")
    event SecureTransferCancelled(
        bytes32 indexed challengeId,
        bytes32 indexed fromVaddr,
        string reason
    );
    
    /// @notice Emitted when account secret is set, updated, or disabled
    /// @param vaddr The virtual address
    /// @param enabled Whether FHE secret is now enabled
    event AccountSecretUpdated(
        bytes32 indexed vaddr,
        bool enabled
    );

    // ============ Constructor ============
    
    /// @notice EVVM Core contract constructor
    /// @param _vChainId Unique virtual chain ID
    /// @param _evvmID EVVM ID for future signature verification
    constructor(uint64 _vChainId, uint256 _evvmID) Ownable(msg.sender) {
        vChainId = _vChainId;
        evvmID = _evvmID;
        vBlockNumber = 0;
        nextTxId = 1; // Start transaction IDs at 1
    }
    
    // ============ Virtual Account Management ============
    
    /// @notice Registers a new account in the virtual blockchain with initial encrypted balance
    /// @param vaddr Virtual identifier of the account (pseudonym, not linked on-chain to real user)
    /// @param initialBalance External encrypted handle for the initial balance
    /// @param inputProof ZK proof validating the encrypted input
    /// @dev vaddr can be keccak256(pubkey), hash of real address, or any unique bytes32
    /// @dev The account will be initialized with nonce 0 and the provided encrypted balance
    /// @dev FHE permissions are automatically set for the contract and sender
    /// @dev Reverts if the account already exists
    /// @dev Emits VirtualAccountRegistered event
    function registerAccount(
        bytes32 vaddr,
        externalEuint64 initialBalance,
        bytes calldata inputProof
    ) external {
        require(!accounts[vaddr].exists, "EVVM: account already exists");
        
        euint64 balance = FHE.fromExternal(initialBalance, inputProof);
        
        VirtualAccount storage acc = accounts[vaddr];
        acc.balance = balance;
        acc.nonce = 0;
        acc.exists = true;
        
        // Allow this contract to operate on the balance
        FHE.allowThis(balance);
        // Make the balance publicly decryptable so anyone with proper permissions can decrypt
        // The frontend will create the necessary permits
        FHE.makePubliclyDecryptable(balance);
        
        emit VirtualAccountRegistered(vaddr, 0);
    }
    
    /// @notice Checks if a virtual account exists
    /// @param vaddr Virtual address of the account
    /// @return exists True if the account exists
    function accountExists(bytes32 vaddr) external view returns (bool) {
        return accounts[vaddr].exists;
    }
    
    /// @notice Returns the encrypted balance of a virtual account
    /// @dev Frontend uses cofhesdkClient.decryptHandle(...) to see the plaintext value
    /// @param vaddr Virtual address of the account
    /// @return balance Encrypted balance (euint64)
    function getEncryptedBalance(
        bytes32 vaddr
    ) external view returns (euint64) {
        require(accounts[vaddr].exists, "EVVM: account does not exist");
        return accounts[vaddr].balance;
    }
    
    /// @notice Returns the current nonce of a virtual account
    /// @param vaddr Virtual address of the account
    /// @return nonce Current nonce (public)
    function getNonce(bytes32 vaddr) external view returns (uint64) {
        require(accounts[vaddr].exists, "EVVM: account does not exist");
        return accounts[vaddr].nonce;
    }
    
    /// @notice Returns the complete virtual account information
    /// @param vaddr Virtual address of the account
    /// @return account The complete VirtualAccount struct
    /// @dev Returns balance (encrypted), nonce, and exists flag
    function getAccount(bytes32 vaddr) external view returns (VirtualAccount memory) {
        require(accounts[vaddr].exists, "EVVM: account does not exist");
        return accounts[vaddr];
    }
    
    // ============ Virtual Transactions ============
    
    /// @notice Applies a transfer within the virtual blockchain
    /// @dev Transaction model: (from, to, amount, nonce, chainId)
    /// @dev For MVP we don't validate signatures, only check nonce and existence
    /// @dev This function increments the virtual block number automatically
    /// @param fromVaddr Source virtual account
    /// @param toVaddr Destination virtual account
    /// @param amount External encrypted handle of the amount
    /// @param inputProof ZK proof validating the encrypted input
    /// @param expectedNonce Nonce that the caller believes `fromVaddr` has
    /// @return txId Transaction ID (unique identifier for this transaction)
    /// @dev Reverts if:
    ///      - Source or destination account doesn't exist
    ///      - Nonce doesn't match the account's current nonce
    /// @dev Emits VirtualTransferApplied event
    /// @dev Updates virtual block number and stores transaction
    function applyTransfer(
        bytes32 fromVaddr,
        bytes32 toVaddr,
        externalEuint64 amount,
        bytes calldata inputProof,
        uint64 expectedNonce
    ) external returns (uint256 txId) {
        return _applyTransferInternal(fromVaddr, toVaddr, amount, inputProof, expectedNonce, true);
    }
    
    /// @notice Internal function to apply a transfer (used by batch processing)
    /// @dev This public function allows batch processing with try/catch
    /// @dev Should only be called internally or via applyTransfer()
    /// @param incrementBlock If true, increments vBlockNumber (for single transfers). If false, caller handles it (for batches)
    function _applyTransferInternal(
        bytes32 fromVaddr,
        bytes32 toVaddr,
        externalEuint64 amount,
        bytes calldata inputProof,
        uint64 expectedNonce,
        bool incrementBlock
    ) public returns (uint256 txId) {
        require(accounts[fromVaddr].exists, "EVVM: from account missing");
        require(accounts[toVaddr].exists, "EVVM: to account missing");
        
        VirtualAccount storage fromAcc = accounts[fromVaddr];
        VirtualAccount storage toAcc = accounts[toVaddr];
        
        // Replay protection: check the nonce
        require(fromAcc.nonce == expectedNonce, "EVVM: bad nonce");
        
        // Convert external encrypted input to internal encrypted type with proof verification
        euint64 amountEnc = FHE.fromExternal(amount, inputProof);
        
        // Make the amount publicly decryptable for transparency
        FHE.makePubliclyDecryptable(amountEnc);
        
        // FHE arithmetic on encrypted balances
        euint64 newFromBalance = FHE.sub(fromAcc.balance, amountEnc);
        euint64 newToBalance = FHE.add(toAcc.balance, amountEnc);
        
        // Update balances
        fromAcc.balance = newFromBalance;
        toAcc.balance = newToBalance;
        
        // Set permissions IMMEDIATELY after updating balances
        // Allow this contract to operate on the new balances
        FHE.allowThis(newFromBalance);
        FHE.allowThis(newToBalance);
        // Make balances publicly decryptable for transparency
        FHE.makePubliclyDecryptable(newFromBalance);
        FHE.makePubliclyDecryptable(newToBalance);
        
        // Capture the nonce that was used for this transaction (before increment)
        // This ensures the event accurately records which nonce was consumed
        uint64 usedNonce = fromAcc.nonce;
        
        // Increment nonce
        fromAcc.nonce += 1;
        
        // Increment virtual block number if this is a single transfer
        if (incrementBlock) {
            vBlockNumber += 1;
            
            // Create or update block information for single transfers
            if (!virtualBlocks[vBlockNumber].exists) {
                virtualBlocks[vBlockNumber] = VirtualBlock({
                    blockNumber: vBlockNumber,
                    stateCommitment: stateCommitment, // Use current commitment
                    timestamp: block.timestamp,
                    transactionCount: 0,
                    exists: true
                });
            }
        }
        
        // Assign unique transaction ID
        txId = nextTxId;
        nextTxId += 1;
        
        // Store the transaction (vBlockNumber is set by caller for batch operations)
        uint64 currentBlockNumber = incrementBlock ? vBlockNumber : 0; // Will be set by batch caller
        virtualTransactions[txId] = VirtualTransaction({
            fromVaddr: fromVaddr,
            toVaddr: toVaddr,
            amountEnc: amountEnc,
            nonce: usedNonce,
            vBlockNumber: currentBlockNumber,
            timestamp: block.timestamp,
            exists: true
        });
        
        // Update block transaction count if block exists
        if (incrementBlock && virtualBlocks[vBlockNumber].exists) {
            virtualBlocks[vBlockNumber].transactionCount += 1;
        }
        
        // Permissions: allow contract to operate on stored transaction amount
        FHE.allowThis(amountEnc);
        FHE.makePubliclyDecryptable(amountEnc);
        
        // Emit event with correct block number
        // For batch operations (incrementBlock=false), the block number will be updated in the stored transaction
        // and the event will show 0 temporarily, but the stored transaction will have the correct block number
        uint64 eventBlockNumber = incrementBlock ? vBlockNumber : 0;
        
        emit VirtualTransferApplied(
            fromVaddr,
            toVaddr,
            amountEnc,
            usedNonce,
            eventBlockNumber,
            txId
        );
        
        return txId;
    }

    // ============ Virtual Block Management ============
    
    /// @notice Creates a new virtual block with a state commitment
    /// @dev This function allows explicit block creation with a cryptographic commitment
    /// @dev Validates that the commitment is not empty and that block number increments correctly
    /// @param newCommitment The state commitment for the new block (e.g., Merkle root of all accounts)
    /// @return blockNumber The newly created block number
    function createVirtualBlock(bytes32 newCommitment) external returns (uint64 blockNumber) {
        // Validation: commitment should not be empty (optional but recommended)
        // Note: bytes32(0) is technically valid but may indicate an error
        require(newCommitment != bytes32(0), "EVVM: commitment cannot be zero");
        
        // Increment block number
        vBlockNumber += 1;
        blockNumber = vBlockNumber;
        
        // Update state commitment
        stateCommitment = newCommitment;
        
        // Store block information
        // Note: transactionCount will be updated by transfer functions
        virtualBlocks[blockNumber] = VirtualBlock({
            blockNumber: blockNumber,
            stateCommitment: newCommitment,
            timestamp: block.timestamp,
            transactionCount: 0, // Will be updated by transactions
            exists: true
        });
        
        // Emit block creation event
        emit VirtualBlockCreated(blockNumber, newCommitment);
        
        return blockNumber;
    }
    
    /// @notice Updates the state commitment without creating a new block
    /// @dev Useful for updating the commitment when state changes occur
    /// @dev Validates that the commitment is not empty
    /// @dev Updates the current block's commitment if it exists
    /// @param newCommitment The new state commitment (must not be bytes32(0))
    /// @dev Reverts if newCommitment is zero
    /// @dev Emits StateCommitmentUpdated event
    function updateStateCommitment(bytes32 newCommitment) external {
        // Validation: commitment should not be empty
        require(newCommitment != bytes32(0), "EVVM: commitment cannot be zero");
        
        // Update state commitment
        stateCommitment = newCommitment;
        
        // Update the current block's commitment if it exists
        if (virtualBlocks[vBlockNumber].exists) {
            virtualBlocks[vBlockNumber].stateCommitment = newCommitment;
        }
        
        emit StateCommitmentUpdated(newCommitment);
    }
    
    /// @notice Retrieves information about a specific virtual block
    /// @param blockNumber The virtual block number to query
    /// @return blockInfo The virtual block struct with all block information
    /// @dev Returns block number, state commitment, timestamp, and transaction count
    function getBlockInfo(uint64 blockNumber) external view returns (VirtualBlock memory blockInfo) {
        require(virtualBlocks[blockNumber].exists, "EVVM: block does not exist");
        return virtualBlocks[blockNumber];
    }
    
    /// @notice Updates the state commitment after a batch of transfers
    /// @dev This function should be called after applyTransferBatch() to update the commitment
    /// @dev Useful for maintaining accurate state commitments after batch operations
    /// @param newCommitment The new state commitment calculated off-chain after the batch
    function updateStateCommitmentAfterBatch(bytes32 newCommitment) external {
        // Validation: commitment should not be empty
        require(newCommitment != bytes32(0), "EVVM: commitment cannot be zero");
        
        // Update state commitment
        stateCommitment = newCommitment;
        
        // Update the current block's commitment
        if (virtualBlocks[vBlockNumber].exists) {
            virtualBlocks[vBlockNumber].stateCommitment = newCommitment;
        } else {
            // If block doesn't exist yet, create it
            virtualBlocks[vBlockNumber] = VirtualBlock({
                blockNumber: vBlockNumber,
                stateCommitment: newCommitment,
                timestamp: block.timestamp,
                transactionCount: 0, // Will be updated by transactions
                exists: true
            });
        }
        
        emit StateCommitmentUpdated(newCommitment);
    }
    
    // ============ Virtual Transaction Queries ============
    
    /// @notice Retrieves a virtual transaction by its ID
    /// @param txId The transaction ID to query
    /// @return tx The virtual transaction struct
    /// @dev Returns a struct with all transaction details including encrypted amount
    function getVirtualTransaction(
        uint256 txId
    ) external view returns (VirtualTransaction memory) {
        require(virtualTransactions[txId].exists, "EVVM: transaction does not exist");
        return virtualTransactions[txId];
    }
    
    // ============ Batch Transfers ============
    
    /// @notice Processes multiple transfers in a single virtual block
    /// @dev All successful transfers are grouped into one virtual block. Failed transfers are skipped.
    /// @dev This function uses try/catch to handle individual transfer failures gracefully
    /// @dev If all transfers fail, the block number increment is reverted
    /// @param transfers Array of transfer parameters to process
    /// @return successfulTxs Number of successfully processed transfers
    /// @return failedTxs Number of failed transfers
    /// @return txIds Array of transaction IDs for successful transfers (0 for failed ones)
    /// @dev Reverts if the transfers array is empty
    /// @dev Each successful transfer emits a VirtualTransferApplied event
    function applyTransferBatch(
        TransferParams[] calldata transfers
    ) external returns (
        uint256 successfulTxs,
        uint256 failedTxs,
        uint256[] memory txIds
    ) {
        uint256 length = transfers.length;
        require(length > 0, "EVVM: empty batch");
        
        // Initialize arrays
        txIds = new uint256[](length);
        
        // Increment virtual block number once for the entire batch
        // All successful transfers will share this block number
        vBlockNumber += 1;
        uint64 batchBlockNumber = vBlockNumber;
        
        // Create block information for the batch
        virtualBlocks[batchBlockNumber] = VirtualBlock({
            blockNumber: batchBlockNumber,
            stateCommitment: stateCommitment, // Use current commitment (can be updated later)
            timestamp: block.timestamp,
            transactionCount: 0, // Will be updated as transactions succeed
            exists: true
        });
        
        // Process each transfer with error handling
        for (uint256 i = 0; i < length; i++) {
            try this._applyTransferInternal(
                transfers[i].fromVaddr,
                transfers[i].toVaddr,
                transfers[i].amount,
                transfers[i].inputProof,
                transfers[i].expectedNonce,
                false // Don't increment block (we handle it for the batch)
            ) returns (uint256 txId) {
                // Success: store the transaction ID
                txIds[i] = txId;
                successfulTxs++;
                
                // Update the stored transaction to use the batch block number
                virtualTransactions[txId].vBlockNumber = batchBlockNumber;
                
                // Update block transaction count
                virtualBlocks[batchBlockNumber].transactionCount += 1;
                
                // Re-emit event with correct block number (optional, for clarity)
                // Note: The event was already emitted in _applyTransferInternal with vBlockNumber=0
                // This is acceptable as events are for logging and the stored transaction has the correct block
            } catch {
                // Failure: mark as failed (txId remains 0)
                txIds[i] = 0;
                failedTxs++;
            }
        }
        
        // If no transfers succeeded, revert the block number increment and remove block
        if (successfulTxs == 0) {
            vBlockNumber -= 1;
            delete virtualBlocks[batchBlockNumber];
        }
        
        return (successfulTxs, failedTxs, txIds);
    }
    
    // ============ Utility Functions ============
    
    /// @notice Generates a virtual address from an Ethereum address and optional salt
    /// @param realAddress The Ethereum address to convert
    /// @param salt Optional salt for additional entropy (use bytes32(0) for default)
    /// @return vaddr The generated virtual address
    /// @dev This is a helper function to create deterministic vaddr from Ethereum addresses
    /// @dev Formula: keccak256(abi.encodePacked(realAddress, vChainId, evvmID, salt))
    function generateVaddrFromAddress(
        address realAddress,
        bytes32 salt
    ) external view returns (bytes32) {
        if (salt == bytes32(0)) {
            // Default: use address, chainId, and evvmID
            return keccak256(abi.encodePacked(realAddress, vChainId, evvmID));
        } else {
            // With custom salt for additional entropy
            return keccak256(abi.encodePacked(realAddress, vChainId, evvmID, salt));
        }
    }
    
    // ============ Signature Functions ============
    
    /// @notice Creates the message hash for a signed transfer operation
    /// @dev This hash includes all contextual data to prevent various replay attacks
    /// @param fromVaddr Source virtual address
    /// @param toVaddr Destination virtual address
    /// @param amountCommitment Commitment to encrypted amount (hash of ciphertext handle)
    /// @param nonce Transaction nonce for replay protection
    /// @param deadline Expiration timestamp for the signature
    /// @return messageHash The hash to be signed by the account owner
    function getTransferMessageHash(
        bytes32 fromVaddr,
        bytes32 toVaddr,
        bytes32 amountCommitment,
        uint64 nonce,
        uint256 deadline
    ) public view returns (bytes32) {
        return keccak256(abi.encodePacked(
            EVVM_DOMAIN,           // Prevents cross-protocol replay
            SIGNATURE_VERSION,      // Allows future upgrades
            fromVaddr,             // Authorizes specific sender
            toVaddr,               // Authorizes specific recipient
            amountCommitment,      // Binds to specific encrypted amount
            nonce,                 // Sequential replay protection
            deadline,              // Time-limited validity
            vChainId,              // Prevents cross-vChain replay
            evvmID,                // Prevents cross-EVVM replay
            block.chainid,         // Prevents cross-L1-chain replay
            address(this)          // Prevents cross-contract replay
        ));
    }
    
    /// @notice Recovers the signer address from an EIP-191 signature
    /// @dev Uses OpenZeppelin's ECDSA library for secure signature recovery
    /// @param messageHash The original message hash (before EIP-191 prefix)
    /// @param sig The signature components (v, r, s)
    /// @return signer The recovered Ethereum address
    function _recoverSigner(
        bytes32 messageHash,
        Signature memory sig
    ) internal pure returns (address) {
        // Apply EIP-191 prefix and recover using OpenZeppelin's secure implementation
        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();
        return ethSignedHash.recover(abi.encodePacked(sig.r, sig.s, sig.v));
    }
    
    /// @notice Applies a signed transfer within the virtual blockchain
    /// @dev Requires valid EIP-191 signature from the account owner (registered address)
    /// @dev This function provides cryptographic authorization beyond nonce-only protection
    /// @param fromVaddr Source virtual account
    /// @param toVaddr Destination virtual account
    /// @param amount External encrypted handle of the amount
    /// @param inputProof ZK proof validating the encrypted input
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
    ) external returns (uint256 txId) {
        // 1. Check deadline hasn't passed
        require(block.timestamp <= deadline, "EVVM: signature expired");
        
        // 2. Get the authorized signer for this vaddr (must be registered via registerAccountFromAddress)
        address authorizedSigner = vaddrToAddress[fromVaddr];
        require(authorizedSigner != address(0), "EVVM: no signer registered for vaddr");
        
        // 3. Create amount commitment (hash of the ciphertext handle for non-malleability)
        // This binds the signature to a specific encrypted value without revealing it
        bytes32 amountCommitment = keccak256(abi.encodePacked(externalEuint64.unwrap(amount)));
        
        // 4. Compute the message hash that should have been signed
        bytes32 messageHash = getTransferMessageHash(
            fromVaddr,
            toVaddr,
            amountCommitment,
            expectedNonce,
            deadline
        );
        
        // 5. Recover signer and verify it matches the authorized address
        address recoveredSigner = _recoverSigner(messageHash, sig);
        require(recoveredSigner == authorizedSigner, "EVVM: invalid signature");
        
        // 6. Process transfer using existing internal logic
        txId = _applyTransferInternal(fromVaddr, toVaddr, amount, inputProof, expectedNonce, true);
        
        // 7. Emit signed transfer event
        emit SignedTransferApplied(
            fromVaddr,
            toVaddr,
            authorizedSigner,
            expectedNonce,
            deadline,
            txId
        );
        
        return txId;
    }
    
    // ============ FHE Hybrid Authentication (Plan 2A) ============
    
    /// @notice Sets up an encrypted secret for FHE authentication
    /// @dev Only callable by the registered address owner
    /// @dev Once set, transfers can use the challenge-response protocol for extra security
    /// @param vaddr The virtual address to set secret for
    /// @param secret The encrypted secret value (user knows plaintext)
    /// @param inputProof ZK proof for the encrypted secret
    function setAccountSecret(
        bytes32 vaddr,
        externalEuint64 secret,
        bytes calldata inputProof
    ) external {
        require(accounts[vaddr].exists, "EVVM: account does not exist");
        require(vaddrToAddress[vaddr] == msg.sender, "EVVM: not account owner");
        
        euint64 encryptedSecret = FHE.fromExternal(secret, inputProof);
        accountSecrets[vaddr] = encryptedSecret;
        fheSecretEnabled[vaddr] = true;
        
        // Only contract can access the secret for comparison
        FHE.allowThis(encryptedSecret);
        // Do NOT allow anyone else to read the secret
        
        emit AccountSecretUpdated(vaddr, true);
    }
    
    /// @notice Disables FHE secret requirement for an account
    /// @dev Only callable by the registered address owner
    /// @dev The secret is kept in storage (user can re-enable without re-setting)
    /// @param vaddr The virtual address to disable secret for
    function disableAccountSecret(bytes32 vaddr) external {
        require(vaddrToAddress[vaddr] == msg.sender, "EVVM: not account owner");
        fheSecretEnabled[vaddr] = false;
        // Keep the secret stored (user might re-enable)
        
        emit AccountSecretUpdated(vaddr, false);
    }
    
    /// @notice Re-enables a previously set FHE secret
    /// @dev Only callable by the registered address owner
    /// @dev Reverts if no secret was ever set
    /// @param vaddr The virtual address to re-enable secret for
    function enableAccountSecret(bytes32 vaddr) external {
        require(vaddrToAddress[vaddr] == msg.sender, "EVVM: not account owner");
        require(euint64.unwrap(accountSecrets[vaddr]) != 0, "EVVM: no secret set");
        fheSecretEnabled[vaddr] = true;
        
        emit AccountSecretUpdated(vaddr, true);
    }
    
    /// @notice Checks if an account has FHE secret enabled
    /// @param vaddr The virtual address to check
    /// @return enabled True if FHE secret is enabled for this account
    function hasSecretEnabled(bytes32 vaddr) external view returns (bool) {
        return fheSecretEnabled[vaddr];
    }
    
    /// @notice Phase A: Request a secure transfer (creates challenge)
    /// @dev Verifies signature but does NOT increment nonce
    /// @dev User must call completeSecureTransfer within CHALLENGE_EXPIRY time
    /// @param fromVaddr Source virtual account
    /// @param toVaddr Destination virtual account
    /// @param amount Encrypted amount handle
    /// @param inputProof ZK proof for amount
    /// @param expectedNonce Nonce at time of request
    /// @param deadline Signature deadline
    /// @param sig EIP-191 signature from account owner
    /// @return challengeId Unique identifier for completing the transfer
    function requestSecureTransfer(
        bytes32 fromVaddr,
        bytes32 toVaddr,
        externalEuint64 amount,
        bytes calldata inputProof,
        uint64 expectedNonce,
        uint256 deadline,
        Signature calldata sig
    ) external returns (bytes32 challengeId) {
        // 1. Check deadline
        require(block.timestamp <= deadline, "EVVM: signature expired");
        
        // 2. Verify FHE secret is enabled for this account
        require(fheSecretEnabled[fromVaddr], "EVVM: FHE secret not enabled");
        
        // 3. Get authorized signer
        address authorizedSigner = vaddrToAddress[fromVaddr];
        require(authorizedSigner != address(0), "EVVM: no signer for vaddr");
        
        // 4. Verify accounts exist
        require(accounts[fromVaddr].exists, "EVVM: from account missing");
        require(accounts[toVaddr].exists, "EVVM: to account missing");
        
        // 5. Verify nonce is still valid (but don't increment!)
        require(accounts[fromVaddr].nonce == expectedNonce, "EVVM: bad nonce");
        
        // 6. Verify signature
        bytes32 amountCommitment = keccak256(abi.encodePacked(externalEuint64.unwrap(amount)));
        bytes32 messageHash = getTransferMessageHash(
            fromVaddr, toVaddr, amountCommitment, expectedNonce, deadline
        );
        require(_recoverSigner(messageHash, sig) == authorizedSigner, "EVVM: invalid signature");
        
        // 7. Generate unique challenge ID
        challengeId = keccak256(abi.encodePacked(
            fromVaddr,
            toVaddr,
            block.timestamp,
            block.prevrandao,
            msg.sender
        ));
        
        // 8. Ensure challenge doesn't already exist
        require(!pendingSecureTransfers[challengeId].exists, "EVVM: challenge exists");
        
        // 9. Store the challenge (nonce NOT incremented)
        pendingSecureTransfers[challengeId] = SecureTransferChallenge({
            fromVaddr: fromVaddr,
            toVaddr: toVaddr,
            amount: amount,
            inputProof: inputProof,
            expectedNonce: expectedNonce,
            deadline: deadline,
            challengeExpiry: block.timestamp + CHALLENGE_EXPIRY,
            challengeHash: keccak256(abi.encodePacked(challengeId, block.timestamp)),
            exists: true
        });
        
        emit SecureTransferRequested(
            challengeId,
            fromVaddr,
            toVaddr,
            block.timestamp + CHALLENGE_EXPIRY
        );
        
        return challengeId;
    }
    
    /// @notice Phase B: Complete secure transfer (verifies secret)
    /// @dev Only increments nonce after successful secret verification
    /// @dev If secret is invalid, transfer amount becomes zero (no funds moved)
    /// @param challengeId The challenge ID from requestSecureTransfer
    /// @param secret The encrypted secret (must match stored secret)
    /// @param secretProof ZK proof for the secret
    /// @return txId Transaction ID
    function completeSecureTransfer(
        bytes32 challengeId,
        externalEuint64 secret,
        bytes calldata secretProof
    ) external returns (uint256 txId) {
        // 1. Get challenge
        SecureTransferChallenge storage challenge = pendingSecureTransfers[challengeId];
        require(challenge.exists, "EVVM: challenge not found");
        
        // 2. Check challenge hasn't expired
        require(block.timestamp <= challenge.challengeExpiry, "EVVM: challenge expired");
        
        // 3. Verify nonce is still valid
        require(
            accounts[challenge.fromVaddr].nonce == challenge.expectedNonce,
            "EVVM: nonce changed"
        );
        
        // 4. Convert encrypted inputs
        euint64 transferAmount = FHE.fromExternal(challenge.amount, challenge.inputProof);
        euint64 providedSecret = FHE.fromExternal(secret, secretProof);
        
        // 5. Verify secret using FHE comparison
        ebool secretValid = FHE.eq(providedSecret, accountSecrets[challenge.fromVaddr]);
        
        // 6. Conditional amount: zero if secret invalid (no theft possible)
        euint64 effectiveAmount = FHE.select(
            secretValid,
            transferAmount,
            FHE.asEuint64(0)
        );
        
        // 7. Execute transfer
        VirtualAccount storage fromAcc = accounts[challenge.fromVaddr];
        VirtualAccount storage toAcc = accounts[challenge.toVaddr];
        
        fromAcc.balance = FHE.sub(fromAcc.balance, effectiveAmount);
        toAcc.balance = FHE.add(toAcc.balance, effectiveAmount);
        
        // 8. Set permissions
        FHE.allowThis(fromAcc.balance);
        FHE.allowThis(toAcc.balance);
        FHE.makePubliclyDecryptable(fromAcc.balance);
        FHE.makePubliclyDecryptable(toAcc.balance);
        FHE.allowThis(effectiveAmount);
        FHE.makePubliclyDecryptable(effectiveAmount);
        
        // 9. Increment nonce (only happens on successful completion)
        uint64 usedNonce = fromAcc.nonce;
        fromAcc.nonce += 1;
        
        // 10. Update virtual block
        vBlockNumber += 1;
        if (!virtualBlocks[vBlockNumber].exists) {
            virtualBlocks[vBlockNumber] = VirtualBlock({
                blockNumber: vBlockNumber,
                stateCommitment: stateCommitment,
                timestamp: block.timestamp,
                transactionCount: 1,
                exists: true
            });
        } else {
            virtualBlocks[vBlockNumber].transactionCount += 1;
        }
        
        // 11. Store transaction
        txId = nextTxId;
        nextTxId += 1;
        
        // Cache values before deletion
        bytes32 fromVaddr = challenge.fromVaddr;
        bytes32 toVaddr = challenge.toVaddr;
        
        virtualTransactions[txId] = VirtualTransaction({
            fromVaddr: fromVaddr,
            toVaddr: toVaddr,
            amountEnc: effectiveAmount,
            nonce: usedNonce,
            vBlockNumber: vBlockNumber,
            timestamp: block.timestamp,
            exists: true
        });
        
        // 12. Clean up challenge
        delete pendingSecureTransfers[challengeId];
        
        // 13. Emit events
        emit VirtualTransferApplied(
            fromVaddr,
            toVaddr,
            effectiveAmount,
            usedNonce,
            vBlockNumber,
            txId
        );
        
        emit SecureTransferCompleted(
            challengeId,
            fromVaddr,
            toVaddr,
            usedNonce,
            txId
        );
        
        return txId;
    }
    
    /// @notice Cancel an expired or unwanted challenge
    /// @dev Anyone can cancel expired challenges (cleanup), only owner can cancel valid ones
    /// @param challengeId The challenge ID to cancel
    function cancelSecureTransfer(bytes32 challengeId) external {
        SecureTransferChallenge storage challenge = pendingSecureTransfers[challengeId];
        require(challenge.exists, "EVVM: challenge not found");
        
        // Anyone can cancel expired challenges
        // Only owner can cancel non-expired challenges
        if (block.timestamp <= challenge.challengeExpiry) {
            require(
                vaddrToAddress[challenge.fromVaddr] == msg.sender,
                "EVVM: not owner, challenge not expired"
            );
        }
        
        bytes32 fromVaddr = challenge.fromVaddr;
        string memory reason = block.timestamp > challenge.challengeExpiry ? "expired" : "cancelled";
        
        delete pendingSecureTransfers[challengeId];
        
        emit SecureTransferCancelled(challengeId, fromVaddr, reason);
    }
    
    /// @notice Get details of a pending secure transfer challenge
    /// @param challengeId The challenge ID to query
    /// @return challenge The challenge details
    function getSecureTransferChallenge(bytes32 challengeId) 
        external 
        view 
        returns (SecureTransferChallenge memory) 
    {
        require(pendingSecureTransfers[challengeId].exists, "EVVM: challenge not found");
        return pendingSecureTransfers[challengeId];
    }
    
    // ============ Admin Functions ============
    
    /// @notice Updates the EVVM ID (admin only)
    /// @dev This function allows the contract owner to update the EVVM ID
    /// @dev The EVVM ID is used for signature verification and vaddr generation
    /// @param newEvvmID The new EVVM ID to set
    function setEvvmID(uint256 newEvvmID) external onlyOwner {
        uint256 oldEvvmID = evvmID;
        evvmID = newEvvmID;
        emit EvvmIDUpdated(oldEvvmID, newEvvmID);
    }

    /// @notice Adds balance to a virtual account via faucet (admin only, for testing)
    /// @dev This function is useful for testing and development
    /// @dev It adds encrypted balance to an existing account without affecting the nonce
    /// @param vaddr The virtual address of the account to add balance to
    /// @param amount External encrypted handle for the amount to add
    /// @param inputProof ZK proof validating the encrypted input
    function faucetAddBalance(
        bytes32 vaddr,
        externalEuint64 amount,
        bytes calldata inputProof
    ) external onlyOwner {
        require(accounts[vaddr].exists, "EVVM: account does not exist");
        
        // Convert external encrypted input to internal encrypted type with proof verification
        euint64 amountEnc = FHE.fromExternal(amount, inputProof);
        
        // Set permissions on the encrypted amount
        FHE.allowThis(amountEnc);
        FHE.allow(amountEnc, msg.sender);
        
        // Get the current account
        VirtualAccount storage acc = accounts[vaddr];
        
        // Add the amount to the existing balance
        euint64 newBalance = FHE.add(acc.balance, amountEnc);
        
        // Update the account balance
        acc.balance = newBalance;
        
        // Set permissions on the new balance
        FHE.allowThis(newBalance);
        // Make the balance publicly decryptable for transparency
        FHE.makePubliclyDecryptable(newBalance);
        
        // Emit event
        emit FaucetBalanceAdded(vaddr, amountEnc);
    }
    
    // ============ Address-to-Vaddr Compatibility Layer ============
    
    /// @notice Registers a new account from an Ethereum address (convenience function)
    /// @dev Automatically generates vaddr from the Ethereum address using vChainId and evvmID
    /// @dev This function creates a mapping between the real address and the generated vaddr
    /// @param realAddress The Ethereum address to register
    /// @param initialBalance External encrypted handle for the initial balance
    /// @param inputProof ZK proof validating the encrypted input
    /// @dev Reverts if the account already exists (either by address or by generated vaddr)
    /// @dev Emits AccountRegisteredFromAddress event
    function registerAccountFromAddress(
        address realAddress,
        externalEuint64 initialBalance,
        bytes calldata inputProof
    ) external {
        // Generate vaddr deterministically from address, vChainId, and evvmID
        bytes32 vaddr = keccak256(abi.encodePacked(realAddress, vChainId, evvmID));
        
        // Check if account already exists
        require(!accounts[vaddr].exists, "EVVM: account already exists");
        
        // Check if address is already mapped (shouldn't happen if vaddr doesn't exist, but double-check)
        require(addressToVaddr[realAddress] == bytes32(0), "EVVM: address already registered");
        
        // Create mappings
        addressToVaddr[realAddress] = vaddr;
        vaddrToAddress[vaddr] = realAddress;
        
        // Register the account (replicate registerAccount logic)
        euint64 balance = FHE.fromExternal(initialBalance, inputProof);
        
        VirtualAccount storage acc = accounts[vaddr];
        acc.balance = balance;
        acc.nonce = 0;
        acc.exists = true;
        
        // Allow this contract to operate on the balance
        FHE.allowThis(balance);
        // Make the balance publicly decryptable for transparency
        FHE.makePubliclyDecryptable(balance);
        
        // Emit both events
        emit VirtualAccountRegistered(vaddr, 0);
        emit AccountRegisteredFromAddress(realAddress, vaddr);
    }
    
    /// @notice Gets the virtual address for a given Ethereum address
    /// @param realAddress The Ethereum address to query
    /// @return vaddr The virtual address associated with the Ethereum address, or bytes32(0) if not registered
    /// @dev Returns bytes32(0) if the address has not been registered via registerAccountFromAddress()
    function getVaddrFromAddress(address realAddress) external view returns (bytes32) {
        return addressToVaddr[realAddress];
    }
    
    /// @notice Compatibility function to request payment using Ethereum addresses instead of vaddr
    /// @dev This function bridges the gap between traditional contracts and the virtual blockchain
    /// @dev It looks up the vaddr for each address and calls applyTransfer()
    /// @param from The Ethereum address of the sender
    /// @param to The Ethereum address of the recipient
    /// @param amount External encrypted handle of the amount
    /// @param inputProof ZK proof validating the encrypted input
    /// @param expectedNonce Nonce that the caller believes the sender's account has
    /// @return txId Transaction ID (unique identifier for this transaction)
    /// @dev Reverts if either address is not registered
    /// @dev Reverts with the same errors as applyTransfer() (bad nonce, account missing, etc.)
    function requestPay(
        address from,
        address to,
        externalEuint64 amount,
        bytes calldata inputProof,
        uint64 expectedNonce
    ) external returns (uint256 txId) {
        bytes32 fromVaddr = addressToVaddr[from];
        bytes32 toVaddr = addressToVaddr[to];
        
        require(fromVaddr != bytes32(0), "EVVM: from address not registered");
        require(toVaddr != bytes32(0), "EVVM: to address not registered");
        
        // Convert external encrypted input to internal encrypted type with proof verification
        euint64 amountEnc = FHE.fromExternal(amount, inputProof);
        
        // Make publicly decryptable for transparency
        FHE.makePubliclyDecryptable(amountEnc);
        
        // Call the internal transfer function with the converted value
        return _applyTransferWithConvertedAmount(fromVaddr, toVaddr, amountEnc, expectedNonce);
    }
    
    /// @notice Signed version of requestPay - requires EIP-191 signature from sender
    /// @dev This function provides cryptographic authorization for address-based transfers
    /// @dev The signature must be from the `from` address
    /// @param from The Ethereum address of the sender (must sign the transaction)
    /// @param to The Ethereum address of the recipient
    /// @param amount External encrypted handle of the amount
    /// @param inputProof ZK proof validating the encrypted input
    /// @param expectedNonce Nonce for replay protection
    /// @param deadline Timestamp after which signature expires
    /// @param sig EIP-191 signature from the sender
    /// @return txId Transaction ID (unique identifier for this transaction)
    function requestPaySigned(
        address from,
        address to,
        externalEuint64 amount,
        bytes calldata inputProof,
        uint64 expectedNonce,
        uint256 deadline,
        Signature calldata sig
    ) external returns (uint256 txId) {
        // 1. Look up virtual addresses
        bytes32 fromVaddr = addressToVaddr[from];
        bytes32 toVaddr = addressToVaddr[to];
        
        require(fromVaddr != bytes32(0), "EVVM: from address not registered");
        require(toVaddr != bytes32(0), "EVVM: to address not registered");
        
        // 2. Check deadline hasn't passed
        require(block.timestamp <= deadline, "EVVM: signature expired");
        
        // 3. Create amount commitment
        bytes32 amountCommitment = keccak256(abi.encodePacked(externalEuint64.unwrap(amount)));
        
        // 4. Compute and verify signature
        bytes32 messageHash = getTransferMessageHash(
            fromVaddr,
            toVaddr,
            amountCommitment,
            expectedNonce,
            deadline
        );
        
        address recoveredSigner = _recoverSigner(messageHash, sig);
        require(recoveredSigner == from, "EVVM: invalid signature");
        
        // 5. Convert encrypted input
        euint64 amountEnc = FHE.fromExternal(amount, inputProof);
        FHE.makePubliclyDecryptable(amountEnc);
        
        // 6. Process transfer
        txId = _applyTransferWithConvertedAmount(fromVaddr, toVaddr, amountEnc, expectedNonce);
        
        // 7. Emit signed transfer event
        emit SignedTransferApplied(
            fromVaddr,
            toVaddr,
            from,
            expectedNonce,
            deadline,
            txId
        );
        
        return txId;
    }
    
    /// @notice Internal helper to apply transfer with already-converted encrypted amount
    /// @dev This is a workaround to handle the conversion separately from the transfer logic
    function _applyTransferWithConvertedAmount(
        bytes32 fromVaddr,
        bytes32 toVaddr,
        euint64 amountEnc,
        uint64 expectedNonce
    ) internal returns (uint256 txId) {
        require(accounts[fromVaddr].exists, "EVVM: from account missing");
        require(accounts[toVaddr].exists, "EVVM: to account missing");
        
        VirtualAccount storage fromAcc = accounts[fromVaddr];
        VirtualAccount storage toAcc = accounts[toVaddr];
        
        // Replay protection: check the nonce
        require(fromAcc.nonce == expectedNonce, "EVVM: bad nonce");
        
        // Amount is already converted and has permissions set
        // FHE arithmetic on encrypted balances
        euint64 newFromBalance = FHE.sub(fromAcc.balance, amountEnc);
        euint64 newToBalance = FHE.add(toAcc.balance, amountEnc);
        
        // Update balances
        fromAcc.balance = newFromBalance;
        toAcc.balance = newToBalance;
        
        // Set permissions on the new balances
        // Allow this contract to operate on them
        FHE.allowThis(newFromBalance);
        FHE.allowThis(newToBalance);
        // Make balances publicly decryptable for transparency
        FHE.makePubliclyDecryptable(newFromBalance);
        FHE.makePubliclyDecryptable(newToBalance);
        
        // Capture the nonce that was used for this transaction (before increment)
        uint64 usedNonce = fromAcc.nonce;
        
        // Increment nonce
        fromAcc.nonce += 1;
        
        // Increment virtual block number
        vBlockNumber += 1;
        
        // Create or update block information
        if (!virtualBlocks[vBlockNumber].exists) {
            virtualBlocks[vBlockNumber] = VirtualBlock({
                blockNumber: vBlockNumber,
                stateCommitment: bytes32(0), // Will be set off-chain
                timestamp: block.timestamp,
                transactionCount: 1,
                exists: true
            });
            emit VirtualBlockCreated(vBlockNumber, bytes32(0));
        } else {
            virtualBlocks[vBlockNumber].transactionCount += 1;
            virtualBlocks[vBlockNumber].timestamp = block.timestamp;
        }
        
        // Store transaction
        txId = nextTxId;
        nextTxId += 1;
        
        virtualTransactions[txId] = VirtualTransaction({
            fromVaddr: fromVaddr,
            toVaddr: toVaddr,
            amountEnc: amountEnc,
            nonce: usedNonce,
            vBlockNumber: vBlockNumber,
            timestamp: block.timestamp,
            exists: true
        });
        
        // Emit event
        emit VirtualTransferApplied(
            fromVaddr,
            toVaddr,
            amountEnc,
            usedNonce,
            vBlockNumber,
            txId
        );
        
        return txId;
    }
}
