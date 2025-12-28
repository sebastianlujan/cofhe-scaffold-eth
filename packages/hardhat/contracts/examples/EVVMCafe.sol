// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../core/EVVM.core.sol";

/// @title EVVMCafe - Coffee Shop Example on EVVM with FHE
/// @notice Example contract demonstrating integration with EVVM Core using encrypted payments
/// @dev This contract uses address-based compatibility functions from EVVMCore
/// @dev All payment amounts are encrypted using FHE (Fully Homomorphic Encryption)
/// @notice Migrated from Fhenix CoFHE to Zama FHEVM
contract EVVMCafe is Ownable {
    // ============ State Variables ============
    
    /// @notice Reference to the EVVM Core contract
    EVVMCore public evvmCore;
    
    /// @notice Owner of the coffee shop (can withdraw funds)
    address public ownerOfShop;
    
    /// @notice Tracks used service nonces per client
    /// @dev Prevents replay attacks on service-level operations
    mapping(address => mapping(uint256 => bool)) private usedNonces;
    
    /// @notice Coffee prices (in plaintext for simplicity, could be encrypted)
    /// @dev In a production system, prices could also be encrypted
    mapping(string => uint256) public coffeePrices;
    
    // ============ Errors ============
    
    /// @notice Error thrown when shop is already registered
    error ShopAlreadyRegistered();
    
    // ============ Events ============
    
    /// @notice Emitted when a coffee order is placed
    /// @param client Address of the client who ordered
    /// @param coffeeType Type of coffee ordered
    /// @param quantity Quantity of coffee ordered
    /// @param evvmNonce Nonce used in the EVVM transaction
    event CoffeeOrdered(
        address indexed client,
        string coffeeType,
        uint256 quantity,
        uint64 evvmNonce
    );
    
    /// @notice Emitted when funds are withdrawn from the shop
    /// @param to Address receiving the funds
    /// @param amountEnc Encrypted amount withdrawn
    event FundsWithdrawn(
        address indexed to,
        euint64 amountEnc
    );

    // ============ Constructor ============
    
    /// @notice Deploys EVVMCafe contract
    /// @param _evvmAddress Address of the deployed EVVMCore contract
    /// @param _ownerOfShop Address of the shop owner (can withdraw funds)
    constructor(
        address _evvmAddress,
        address _ownerOfShop
    ) Ownable(msg.sender) {
        evvmCore = EVVMCore(_evvmAddress);
        ownerOfShop = _ownerOfShop;
        
        // Initialize coffee prices (in a real system, these could be encrypted)
        coffeePrices["espresso"] = 2; // 2 tokens
        coffeePrices["latte"] = 4;    // 4 tokens
        coffeePrices["cappuccino"] = 4; // 4 tokens
        coffeePrices["americano"] = 3;  // 3 tokens
    }

    // ============ Coffee Ordering ============
    
    /// @notice Places a coffee order after payment has been made via EVVMCore
    /// @param clientAddress Address of the client placing the order
    /// @param coffeeType Type of coffee (e.g., "espresso", "latte")
    /// @param quantity Number of coffees to order
    /// @param paymentTxId Transaction ID from EVVMCore.requestPay() that was called separately
    /// @param nonce Service-level nonce to prevent replay attacks
    /// @param expectedNonce The nonce that was used in the payment transaction
    /// @dev The client must call EVVMCore.requestPay() first from the frontend, then call this function with the txId
    /// @dev This function verifies that the payment was successful by checking:
    ///      - The transaction exists
    ///      - The transaction is from the client to the shop
    ///      - The nonce matches (proving the payment consumed the expected nonce)
    ///      - The client's current nonce is expectedNonce + 1 (proving payment was processed)
    function orderCoffee(
        address clientAddress,
        string memory coffeeType,
        uint256 quantity,
        uint256 paymentTxId,
        uint256 nonce,
        uint64 expectedNonce
    ) external {
        // 1. Validate input
        require(quantity > 0, "EVVMCafe: quantity must be greater than 0");
        require(bytes(coffeeType).length > 0, "EVVMCafe: coffee type required");
        require(coffeePrices[coffeeType] > 0, "EVVMCafe: invalid coffee type");
        
        // 2. Check service nonce (prevent replay)
        require(!usedNonces[clientAddress][nonce], "EVVMCafe: nonce already used");
        
        // 3. Verify client is registered in EVVM
        bytes32 clientVaddr = evvmCore.getVaddrFromAddress(clientAddress);
        require(clientVaddr != bytes32(0), "EVVMCafe: client not registered in EVVM");
        
        // 4. Verify shop is registered in EVVM
        bytes32 shopVaddr = evvmCore.getVaddrFromAddress(address(this));
        require(shopVaddr != bytes32(0), "EVVMCafe: shop must be registered in EVVM before first order");
        
        // 5. Verify payment transaction exists and is valid
        EVVMCore.VirtualTransaction memory paymentTx = evvmCore.getVirtualTransaction(paymentTxId);
        require(paymentTx.exists, "EVVMCafe: payment transaction does not exist");
        require(paymentTx.fromVaddr == clientVaddr, "EVVMCafe: payment transaction not from client");
        require(paymentTx.toVaddr == shopVaddr, "EVVMCafe: payment transaction not to shop");
        require(paymentTx.nonce == expectedNonce, "EVVMCafe: payment transaction nonce mismatch");
        
        // 6. Verify client's current nonce matches expectedNonce + 1 (proving payment was processed)
        uint64 currentNonce = evvmCore.getNonce(clientVaddr);
        require(currentNonce == expectedNonce + 1, "EVVMCafe: client nonce does not match payment");
        
        // 7. Mark service nonce as used
        usedNonces[clientAddress][nonce] = true;
        
        // 8. Emit event
        emit CoffeeOrdered(clientAddress, coffeeType, quantity, expectedNonce);
    }

    // ============ Fund Management ============
    
    /// @notice Withdraws encrypted funds from the shop to the owner
    /// @param to Address to receive the funds (must be registered in EVVM)
    /// @param amountEnc External encrypted handle for the amount to withdraw
    /// @param inputProof ZK proof validating the encrypted input
    /// @dev Only the shop owner can call this function
    function withdrawFunds(
        address to,
        externalEuint64 amountEnc,
        bytes calldata inputProof
    ) external onlyOwner {
        require(to != address(0), "EVVMCafe: invalid recipient address");
        
        // Get shop and recipient vaddr
        bytes32 shopVaddr = evvmCore.getVaddrFromAddress(address(this));
        bytes32 toVaddr = evvmCore.getVaddrFromAddress(to);
        
        require(shopVaddr != bytes32(0), "EVVMCafe: shop not registered");
        require(toVaddr != bytes32(0), "EVVMCafe: recipient not registered");
        
        // Get current nonce for the shop
        uint64 nonce = evvmCore.getNonce(shopVaddr);
        
        // Transfer encrypted funds (now requires inputProof)
        evvmCore.applyTransfer(shopVaddr, toVaddr, amountEnc, inputProof, nonce);
        
        // Convert external encrypted input to internal type for the event
        euint64 amountEncEuint = FHE.fromExternal(amountEnc, inputProof);
        
        emit FundsWithdrawn(to, amountEncEuint);
    }

    // ============ Query Functions ============
    
    /// @notice Returns the encrypted balance of the coffee shop
    /// @return balance Encrypted balance (euint64)
    /// @dev Frontend must decrypt this using cofhesdkClient.decryptHandle()
    function getShopBalance() external view returns (euint64) {
        bytes32 shopVaddr = evvmCore.getVaddrFromAddress(address(this));
        require(shopVaddr != bytes32(0), "EVVMCafe: shop not registered");
        return evvmCore.getEncryptedBalance(shopVaddr);
    }
    
    /// @notice Returns the encrypted balance of a client
    /// @param client Address of the client
    /// @return balance Encrypted balance (euint64)
    /// @dev Frontend must decrypt this using cofhesdkClient.decryptHandle()
    function getClientBalance(address client) external view returns (euint64) {
        bytes32 clientVaddr = evvmCore.getVaddrFromAddress(client);
        require(clientVaddr != bytes32(0), "EVVMCafe: client not registered");
        return evvmCore.getEncryptedBalance(clientVaddr);
    }
    
    /// @notice Checks if a service nonce has been used
    /// @param client Address of the client
    /// @param nonce Service nonce to check
    /// @return used True if the nonce has been used
    function isNonceUsed(address client, uint256 nonce) external view returns (bool) {
        return usedNonces[client][nonce];
    }
    
    /// @notice Gets the price of a coffee type
    /// @param coffeeType Type of coffee
    /// @return price Price in tokens (plaintext)
    function getCoffeePrice(string memory coffeeType) external view returns (uint256) {
        return coffeePrices[coffeeType];
    }

    // ============ Setup Functions ============
    
    /// @notice Registers the shop in EVVM Core (must be called before first order)
    /// @param initialBalance External encrypted handle for the initial balance (usually zero)
    /// @param inputProof ZK proof validating the encrypted input
    /// @dev This function should be called during setup to register the shop's address in EVVM
    /// @dev The shop address will be automatically mapped to a vaddr
    /// @dev Logic:
    ///   1. Check if shop address is already mapped to a vaddr in EVVMCore
    ///   2. If mapped, verify the account exists - if yes, revert with ShopAlreadyRegistered
    ///   3. If not mapped, generate the vaddr deterministically and check if account exists
    ///   4. If account exists via generated vaddr, revert with ShopAlreadyRegistered
    ///   5. Otherwise, call registerAccountFromAddress to register the shop
    function registerShopInEVVM(externalEuint64 initialBalance, bytes calldata inputProof) external {
        // Step 1: Check if address is already mapped to a vaddr
        bytes32 shopVaddr = evvmCore.getVaddrFromAddress(address(this));
        if (shopVaddr != bytes32(0)) {
            // Step 2: If mapped, verify the account actually exists
            if (evvmCore.accountExists(shopVaddr)) {
                revert ShopAlreadyRegistered();
            }
            // If mapped but account doesn't exist, something is wrong - continue anyway
        }
        
        // Step 3: Generate the vaddr deterministically (same formula used in registerAccountFromAddress)
        bytes32 generatedVaddr = evvmCore.generateVaddrFromAddress(address(this), bytes32(0));
        
        // Step 4: Check if account exists via generated vaddr
        // This handles the case where shop was registered via registerAccount() directly
        // (without using registerAccountFromAddress, so no mapping was created)
        if (evvmCore.accountExists(generatedVaddr)) {
            revert ShopAlreadyRegistered();
        }
        
        // Step 5: Register shop using address-based function (now requires inputProof)
        // This will:
        //   - Generate the same vaddr we just checked
        //   - Create the mapping addressToVaddr[address(this)] = vaddr
        //   - Create the account with the encrypted balance
        //   - Set FHE permissions
        // If the shop is already registered, this will revert with:
        //   - "EVVM: account already exists" (if vaddr exists)
        //   - "EVVM: address already registered" (if address is mapped)
        evvmCore.registerAccountFromAddress(address(this), initialBalance, inputProof);
    }
    
    /// @notice Checks if the shop is registered in EVVM
    /// @return registered True if the shop is registered
    function isShopRegistered() external view returns (bool) {
        // First check if address is mapped to a vaddr
        bytes32 shopVaddr = evvmCore.getVaddrFromAddress(address(this));
        if (shopVaddr != bytes32(0)) {
            // If mapped, verify the account actually exists
            return evvmCore.accountExists(shopVaddr);
        }
        
        // If not mapped, try to generate the vaddr and check if account exists
        // This handles the case where shop was registered via registerAccount() directly
        bytes32 generatedVaddr = evvmCore.generateVaddrFromAddress(address(this), bytes32(0));
        return evvmCore.accountExists(generatedVaddr);
    }

    // ============ Admin Functions ============
    
    /// @notice Sets the price of a coffee type (owner only)
    /// @param coffeeType Type of coffee
    /// @param price New price in tokens
    function setCoffeePrice(string memory coffeeType, uint256 price) external onlyOwner {
        require(bytes(coffeeType).length > 0, "EVVMCafe: coffee type required");
        coffeePrices[coffeeType] = price;
    }
    
    /// @notice Updates the shop owner address (owner only)
    /// @param newOwner New owner address
    function setShopOwner(address newOwner) external onlyOwner {
        require(newOwner != address(0), "EVVMCafe: invalid owner address");
        ownerOfShop = newOwner;
    }
}

