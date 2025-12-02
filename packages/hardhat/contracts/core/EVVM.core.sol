// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";
import "@openzeppelin/contracts/access/Ownable.sol";


/// @title EVVM Core - Virtual Blockchain with FHE
/// @notice MVP of EVVM Core as "virtual blockchain" using FHE for private balances
/// @dev Step 9: Admin functions and testing utilities
contract EVVMCore is Ownable {
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
    
    /// @notice Parameters for a batch transfer operation
    struct TransferParams {
        bytes32 fromVaddr;    // Source virtual account
        bytes32 toVaddr;      // Destination virtual account
        InEuint64 amount;     // Encrypted amount to transfer
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
    
    // ============ Events ============
    
    /// @notice Emitted when a new virtual account is registered
    event VirtualAccountRegistered(
        bytes32 indexed vaddr,
        uint64 initialNonce
    );
    
    /// @notice Emitted when a virtual transaction is applied
    event VirtualTransferApplied(
        bytes32 indexed fromVaddr,
        bytes32 indexed toVaddr,
        euint64 amountEnc,
        uint64 nonce,
        uint64 vBlockNumber,
        uint256 txId
    );
    
    /// @notice Emitted when the virtual state commitment is updated
    event StateCommitmentUpdated(bytes32 newCommitment);
    
    /// @notice Emitted when a virtual block is created
    event VirtualBlockCreated(
        uint64 indexed vBlockNumber,
        bytes32 stateCommitment
    );
    
    /// @notice Emitted when the EVVM ID is updated
    event EvvmIDUpdated(uint256 oldEvvmID, uint256 newEvvmID);
    
    /// @notice Emitted when balance is added via faucet
    event FaucetBalanceAdded(
        bytes32 indexed vaddr,
        euint64 amountAdded
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
    /// @param initialBalance Encrypted handle generated with CoFHE (InEuint64)
    /// @dev vaddr can be keccak256(pubkey), hash of real address, or any unique bytes32
    function registerAccount(
        bytes32 vaddr,
        InEuint64 calldata initialBalance
    ) external {
        require(!accounts[vaddr].exists, "EVVM: account already exists");
        
        euint64 balance = FHE.asEuint64(initialBalance);
        
        VirtualAccount storage acc = accounts[vaddr];
        acc.balance = balance;
        acc.nonce = 0;
        acc.exists = true;
        
        // Allow this contract to operate on the balance
        FHE.allowThis(balance);
        // Optional: allow sender to read/use the balance
        FHE.allowSender(balance);
        
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
    /// For MVP we don't validate signatures, only check nonce and existence
    /// @param fromVaddr Source virtual account
    /// @param toVaddr Destination virtual account
    /// @param amount Encrypted handle of the amount (InEuint64)
    /// @param expectedNonce Nonce that the caller believes `fromVaddr` has
    /// @return txId Transaction ID (unique identifier for this transaction)
    function applyTransfer(
        bytes32 fromVaddr,
        bytes32 toVaddr,
        InEuint64 calldata amount,
        uint64 expectedNonce
    ) external returns (uint256 txId) {
        return _applyTransferInternal(fromVaddr, toVaddr, amount, expectedNonce, true);
    }
    
    /// @notice Internal function to apply a transfer (used by batch processing)
    /// @dev This public function allows batch processing with try/catch
    /// @dev Should only be called internally or via applyTransfer()
    /// @param incrementBlock If true, increments vBlockNumber (for single transfers). If false, caller handles it (for batches)
    function _applyTransferInternal(
        bytes32 fromVaddr,
        bytes32 toVaddr,
        InEuint64 calldata amount,
        uint64 expectedNonce,
        bool incrementBlock
    ) public returns (uint256 txId) {
        require(accounts[fromVaddr].exists, "EVVM: from account missing");
        require(accounts[toVaddr].exists, "EVVM: to account missing");
        
        VirtualAccount storage fromAcc = accounts[fromVaddr];
        VirtualAccount storage toAcc = accounts[toVaddr];
        
        // Replay protection: check the nonce
        require(fromAcc.nonce == expectedNonce, "EVVM: bad nonce");
        
        // Interpret the handle as encrypted uint64
        euint64 amountEnc = FHE.asEuint64(amount);
        
        // Set permissions on the encrypted amount before using it in operations
        // This contract needs permission to operate on the encrypted value
        FHE.allowThis(amountEnc);
        // Allow sender to use the encrypted amount (for potential future operations)
        FHE.allowSender(amountEnc);
        
        // FHE arithmetic on encrypted balances
        euint64 newFromBalance = FHE.sub(fromAcc.balance, amountEnc);
        euint64 newToBalance = FHE.add(toAcc.balance, amountEnc);
        
        // Update balances
        fromAcc.balance = newFromBalance;
        toAcc.balance = newToBalance;
        
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
        
        // Permissions: contract and sender can operate/read the new balances
        FHE.allowThis(newFromBalance);
        FHE.allowThis(newToBalance);
        FHE.allowSender(newFromBalance);
        FHE.allowSender(newToBalance);
        
        // Permissions: allow contract and sender to read the stored transaction amount
        FHE.allowThis(amountEnc);
        FHE.allowSender(amountEnc);
        
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
    /// @param newCommitment The new state commitment
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
    /// @param transfers Array of transfer parameters to process
    /// @return successfulTxs Number of successfully processed transfers
    /// @return failedTxs Number of failed transfers
    /// @return txIds Array of transaction IDs for successful transfers (0 for failed ones)
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
    /// @param amount The encrypted amount to add (InEuint64)
    function faucetAddBalance(
        bytes32 vaddr,
        InEuint64 calldata amount
    ) external onlyOwner {
        require(accounts[vaddr].exists, "EVVM: account does not exist");
        
        // Convert the input handle to encrypted uint64
        euint64 amountEnc = FHE.asEuint64(amount);
        
        // Set permissions on the encrypted amount
        FHE.allowThis(amountEnc);
        FHE.allowSender(amountEnc);
        
        // Get the current account
        VirtualAccount storage acc = accounts[vaddr];
        
        // Add the amount to the existing balance
        euint64 newBalance = FHE.add(acc.balance, amountEnc);
        
        // Update the account balance
        acc.balance = newBalance;
        
        // Set permissions on the new balance
        FHE.allowThis(newBalance);
        FHE.allowSender(newBalance);
        
        // Emit event
        emit FaucetBalanceAdded(vaddr, amountEnc);
    }
}
