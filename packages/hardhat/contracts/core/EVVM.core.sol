// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";
import "@openzeppelin/contracts/access/Ownable.sol";


/// @title EVVM Core - Virtual Blockchain with FHE
/// @notice MVP of EVVM Core as "virtual blockchain" using FHE for private balances
/// @dev Step 2: Virtual account system
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
    /// @dev Will be implemented in step 3
    event VirtualTransferApplied(
        bytes32 indexed fromVaddr,
        bytes32 indexed toVaddr,
        euint64 amountEnc,
        uint64 nonce,
        uint64 vBlockNumber,
        uint256 txId
    );
    
    /// @notice Emitted when the virtual state commitment is updated
    /// @dev Will be implemented in step 4
    event StateCommitmentUpdated(bytes32 newCommitment);
    
    /// @notice Emitted when a virtual block is created
    /// @dev Will be implemented in step 4
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
}
