// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";
import "@openzeppelin/contracts/access/Ownable.sol";


/// @title EVVM Core - Virtual Blockchain with FHE
/// @notice MVP of EVVM Core as "virtual blockchain" using FHE for private balances
/// @dev Step 4: Virtual chain progression
contract EVVMCore is Ownable {
    // ============ Structs ============
    
    /// @notice Represents an account within the virtual blockchain
    struct VirtualAccount {
        euint64 balance;      // Encrypted balance of the principal token
        uint64 nonce;         // Transaction counter from this account (public for replay protection)
        bool exists;          // Existence flag
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

    // ============ Constructor ============
    
    /// @notice EVVM Core contract constructor
    /// @param _vChainId Unique virtual chain ID
    /// @param _evvmID EVVM ID for future signature verification
    constructor(uint64 _vChainId, uint256 _evvmID) Ownable(msg.sender) {
        vChainId = _vChainId;
        evvmID = _evvmID;
        vBlockNumber = 0;
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

    // ============ Virtual Transactions ============
    
    /// @notice Applies a transfer within the virtual blockchain
    /// @dev Transaction model: (from, to, amount, nonce, chainId)
    /// For MVP we don't validate signatures, only check nonce and existence
    /// @param fromVaddr Source virtual account
    /// @param toVaddr Destination virtual account
    /// @param amount Encrypted handle of the amount (InEuint64)
    /// @param expectedNonce Nonce that the caller believes `fromVaddr` has
    /// @return txId Transaction ID (temporary, will be properly stored in step 5)
    function applyTransfer(
        bytes32 fromVaddr,
        bytes32 toVaddr,
        InEuint64 calldata amount,
        uint64 expectedNonce
    ) external returns (uint256 txId) {
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
        
        // Increment nonce and virtual chain height
        fromAcc.nonce += 1;
        vBlockNumber += 1;
        
        // Temporary txId (will be properly implemented in step 5)
        txId = vBlockNumber; // Using block number as temporary ID
        
        // Permissions: contract and sender can operate/read the new balances
        FHE.allowThis(newFromBalance);
        FHE.allowThis(newToBalance);
        FHE.allowSender(newFromBalance);
        FHE.allowSender(newToBalance);
        
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

    // ============ Virtual Block Management ============
    
    /// @notice Creates a new virtual block with a state commitment
    /// @dev This function allows explicit block creation with a cryptographic commitment
    /// @param newCommitment The state commitment for the new block (e.g., Merkle root of all accounts)
    function createVirtualBlock(bytes32 newCommitment) external {
        // Increment block number
        vBlockNumber += 1;
        
        // Update state commitment
        stateCommitment = newCommitment;
        
        // Emit block creation event
        emit VirtualBlockCreated(vBlockNumber, newCommitment);
    }
    
    /// @notice Updates the state commitment without creating a new block
    /// @dev Useful for updating the commitment when state changes occur
    /// @param newCommitment The new state commitment
    function updateStateCommitment(bytes32 newCommitment) external {
        stateCommitment = newCommitment;
        emit StateCommitmentUpdated(newCommitment);
    }
}
