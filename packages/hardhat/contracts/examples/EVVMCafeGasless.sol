// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "../library/FheEvvmService.sol";

/// @title EVVMCafeGasless - Gasless Coffee Shop on EVVM with FHE
/// @notice Coffee shop contract with gasless transactions via EIP-191 signatures
/// @dev Users sign orders off-chain (no gas), fishers execute on-chain (pay gas, earn rewards)
/// 
/// @dev Gasless Flow:
/// 1. User encrypts payment amount using FHE
/// 2. User signs EIP-191 message - NO GAS
/// 3. User submits signature to Fisher API
/// 4. Fisher validates and calls orderCoffeeGasless() - PAYS GAS
/// 5. Contract verifies signature, processes payment, rewards fisher
/// 
/// @dev EIP-191 Message Format:
/// "{serviceId},orderCoffee,{client},{coffeeType},{quantity},{serviceNonce},{amountCommitment},{evvmNonce},{deadline},{priorityFee}"
/// Example: "1,orderCoffee,0x1234...,espresso,2,1,0x5678...,0,1735689600,1"
/// 
/// @dev Key Features:
/// - Simple comma-separated message format (EVVM standard)
/// - Atomic execution (payment fails = order fails)
/// - Async service nonces (retry with same signature until deadline)
/// - Fisher reward mechanism via priority fee
contract EVVMCafeGasless is FheEvvmService, Ownable {
    using Strings for uint256;
    using Strings for uint64;

    // ============ Constants ============
    
    /// @notice Service ID for this cafe (used in EIP-191 messages)
    uint256 public constant CAFE_SERVICE_ID = 1;

    // ============ State Variables ============
    
    /// @notice Owner of the coffee shop (can withdraw funds)
    address public ownerOfShop;
    
    /// @notice Coffee prices (in plaintext for simplicity)
    /// @dev In production, prices could also be encrypted
    mapping(string => uint256) public coffeePrices;
    
    // ============ Errors ============
    
    /// @notice Error when shop is already registered
    error ShopAlreadyRegistered();
    
    /// @notice Error when quantity is invalid
    error InvalidQuantity();
    
    /// @notice Error when coffee type is invalid
    error InvalidCoffeeType();
    
    /// @notice Error when shop is not registered
    error ShopNotRegistered();

    // ============ Events ============
    
    /// @notice Emitted when a gasless coffee order is placed
    /// @param client Address of the client who ordered
    /// @param coffeeType Type of coffee ordered
    /// @param quantity Quantity ordered
    /// @param evvmNonce EVVM nonce used in the payment
    /// @param fisher Address of the fisher who executed the order
    /// @param priorityFee Fee paid to the fisher
    event GaslessCoffeeOrdered(
        address indexed client,
        string coffeeType,
        uint256 quantity,
        uint64 evvmNonce,
        address indexed fisher,
        uint256 priorityFee
    );
    
    /// @notice Emitted when a legacy (non-gasless) order is placed
    /// @param client Address of the client who ordered
    /// @param coffeeType Type of coffee ordered
    /// @param quantity Quantity ordered
    /// @param evvmNonce EVVM nonce used
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
    
    /// @notice Deploys EVVMCafeGasless contract
    /// @param _evvmAddress Address of the deployed EVVMCore contract
    /// @param _ownerOfShop Address of the shop owner (can withdraw funds)
    constructor(
        address _evvmAddress,
        address _ownerOfShop
    ) 
        FheEvvmService(_evvmAddress, "EVVM Cafe", CAFE_SERVICE_ID)
        Ownable(msg.sender) 
    {
        ownerOfShop = _ownerOfShop;
        
        // Initialize coffee prices (in tokens)
        coffeePrices["espresso"] = 2;
        coffeePrices["latte"] = 4;
        coffeePrices["cappuccino"] = 4;
        coffeePrices["americano"] = 3;
    }

    // ============ Gasless Coffee Ordering ============
    
    /// @notice Places a gasless coffee order using EIP-191 signature
    /// @dev Fisher calls this function, user only signs
    /// @dev Message format: "{serviceId},orderCoffee,{client},{coffeeType},{quantity},{serviceNonce},{amountCommitment},{evvmNonce},{deadline},{priorityFee}"
    /// @param client The client address placing the order
    /// @param coffeeType Type of coffee
    /// @param quantity Number of coffees
    /// @param serviceNonce Unique nonce for this order (async - any unused value)
    /// @param amountCommitment keccak256 hash of the encrypted amount handle
    /// @param evvmNonce The EVVM nonce for the payment
    /// @param deadline Timestamp after which signature expires
    /// @param priorityFee Amount to reward the fisher
    /// @param encryptedAmount The FHE-encrypted payment amount
    /// @param inputProof ZK proof for the encrypted amount
    /// @param signature EIP-191 signature from the client
    function orderCoffeeGasless(
        address client,
        string calldata coffeeType,
        uint256 quantity,
        uint256 serviceNonce,
        bytes32 amountCommitment,
        uint64 evvmNonce,
        uint256 deadline,
        uint256 priorityFee,
        externalEuint64 encryptedAmount,
        bytes calldata inputProof,
        bytes calldata signature
    ) external {
        // 1. Verify deadline hasn't passed
        if (block.timestamp > deadline) {
            revert SignatureExpired();
        }
        
        // 2. Verify amount commitment matches encrypted input
        _verifyAmountCommitment(amountCommitment, encryptedAmount);
        
        // 3. Verify service nonce hasn't been used (allows retry until deadline)
        _verifyServiceNonce(client, serviceNonce);
        
        // 4. Build and verify EIP-191 signature
        string memory message = _buildOrderMessage(
            client,
            coffeeType,
            quantity,
            serviceNonce,
            amountCommitment,
            evvmNonce,
            deadline,
            priorityFee
        );
        _requireValidEIP191Signature(message, signature, client);
        
        // 5. Validate order details
        if (quantity == 0) {
            revert InvalidQuantity();
        }
        if (coffeePrices[coffeeType] == 0) {
            revert InvalidCoffeeType();
        }
        
        // 6. Verify shop is registered
        if (!_isShopRegistered()) {
            revert ShopNotRegistered();
        }
        
        // 7. Process payment atomically (calls EVVMCore internally)
        _processPayment(
            client,
            address(this),
            encryptedAmount,
            inputProof,
            evvmNonce
        );
        
        // 8. Reward fisher (msg.sender) with priority fee
        _rewardFisher(msg.sender, priorityFee);
        
        // 9. Mark service nonce as used
        _markServiceNonceUsed(client, serviceNonce);
        
        // 10. Emit event
        emit GaslessCoffeeOrdered(
            client,
            coffeeType,
            quantity,
            evvmNonce,
            msg.sender,
            priorityFee
        );
    }

    /// @notice Builds the EIP-191 message for an order
    /// @dev Format: "{serviceId},orderCoffee,{client},{coffeeType},{quantity},{serviceNonce},{amountCommitment},{evvmNonce},{deadline},{priorityFee}"
    function _buildOrderMessage(
        address client,
        string calldata coffeeType,
        uint256 quantity,
        uint256 serviceNonce,
        bytes32 amountCommitment,
        uint64 evvmNonce,
        uint256 deadline,
        uint256 priorityFee
    ) internal view returns (string memory) {
        return string(abi.encodePacked(
            serviceId.toString(),
            ",orderCoffee,",
            _addressToString(client),
            ",",
            coffeeType,
            ",",
            quantity.toString(),
            ",",
            serviceNonce.toString(),
            ",",
            _bytes32ToHexString(amountCommitment),
            ",",
            uint256(evvmNonce).toString(),
            ",",
            deadline.toString(),
            ",",
            priorityFee.toString()
        ));
    }

    // ============ Legacy Order Function (Backward Compatibility) ============
    
    /// @notice Places a coffee order after payment has been made via EVVMCore
    /// @dev This is the original non-gasless version for backward compatibility
    /// @param clientAddress Address of the client placing the order
    /// @param coffeeType Type of coffee
    /// @param quantity Number of coffees to order
    /// @param paymentTxId Transaction ID from EVVMCore.requestPay()
    /// @param nonce Service-level nonce
    /// @param expectedNonce The nonce used in the payment transaction
    function orderCoffee(
        address clientAddress,
        string memory coffeeType,
        uint256 quantity,
        uint256 paymentTxId,
        uint256 nonce,
        uint64 expectedNonce
    ) external {
        // 1. Validate input
        if (quantity == 0) {
            revert InvalidQuantity();
        }
        if (coffeePrices[coffeeType] == 0) {
            revert InvalidCoffeeType();
        }
        
        // 2. Check service nonce
        _verifyServiceNonce(clientAddress, nonce);
        
        // 3. Verify client is registered in EVVM
        bytes32 clientVaddr = evvm.getVaddrFromAddress(clientAddress);
        if (clientVaddr == bytes32(0)) {
            revert UserNotRegistered();
        }
        
        // 4. Verify shop is registered
        if (!_isShopRegistered()) {
            revert ShopNotRegistered();
        }
        bytes32 shopVaddr = evvm.getVaddrFromAddress(address(this));
        
        // 5. Verify payment transaction
        EVVMCore.VirtualTransaction memory paymentTx = evvm.getVirtualTransaction(paymentTxId);
        require(paymentTx.exists, "EVVMCafe: payment tx missing");
        require(paymentTx.fromVaddr == clientVaddr, "EVVMCafe: wrong sender");
        require(paymentTx.toVaddr == shopVaddr, "EVVMCafe: wrong recipient");
        require(paymentTx.nonce == expectedNonce, "EVVMCafe: nonce mismatch");
        
        // 6. Verify nonce was consumed
        uint64 currentNonce = evvm.getNonce(clientVaddr);
        require(currentNonce == expectedNonce + 1, "EVVMCafe: payment not processed");
        
        // 7. Mark service nonce as used
        _markServiceNonceUsed(clientAddress, nonce);
        
        // 8. Emit event
        emit CoffeeOrdered(clientAddress, coffeeType, quantity, expectedNonce);
    }

    // ============ Fund Management ============
    
    /// @notice Withdraws encrypted funds from the shop to the owner
    /// @param to Address to receive the funds
    /// @param amountEnc External encrypted handle for the amount
    /// @param inputProof ZK proof for the encrypted input
    function withdrawFunds(
        address to,
        externalEuint64 amountEnc,
        bytes calldata inputProof
    ) external onlyOwner {
        require(to != address(0), "EVVMCafe: invalid recipient");
        
        bytes32 shopVaddr = evvm.getVaddrFromAddress(address(this));
        bytes32 toVaddr = evvm.getVaddrFromAddress(to);
        
        require(shopVaddr != bytes32(0), "EVVMCafe: shop not registered");
        require(toVaddr != bytes32(0), "EVVMCafe: recipient not registered");
        
        uint64 nonce = evvm.getNonce(shopVaddr);
        
        evvm.applyTransfer(shopVaddr, toVaddr, amountEnc, inputProof, nonce);
        
        euint64 amountEncEuint = FHE.fromExternal(amountEnc, inputProof);
        emit FundsWithdrawn(to, amountEncEuint);
    }

    // ============ Query Functions ============
    
    /// @notice Returns the encrypted balance of the coffee shop
    function getShopBalance() external view returns (euint64) {
        bytes32 shopVaddr = evvm.getVaddrFromAddress(address(this));
        require(shopVaddr != bytes32(0), "EVVMCafe: shop not registered");
        return evvm.getEncryptedBalance(shopVaddr);
    }
    
    /// @notice Returns the encrypted balance of a client
    function getClientBalance(address client) external view returns (euint64) {
        bytes32 clientVaddr = evvm.getVaddrFromAddress(client);
        require(clientVaddr != bytes32(0), "EVVMCafe: client not registered");
        return evvm.getEncryptedBalance(clientVaddr);
    }
    
    /// @notice Gets the price of a coffee type
    function getCoffeePrice(string memory coffeeType) external view returns (uint256) {
        return coffeePrices[coffeeType];
    }
    
    /// @notice Checks if the shop is registered in EVVM
    function isShopRegistered() external view returns (bool) {
        return _isShopRegistered();
    }

    // ============ Setup Functions ============
    
    /// @notice Registers the shop in EVVM Core
    /// @param initialBalance Encrypted initial balance (usually zero)
    /// @param inputProof ZK proof for the encrypted input
    function registerShopInEVVM(
        externalEuint64 initialBalance, 
        bytes calldata inputProof
    ) external {
        bytes32 shopVaddr = evvm.getVaddrFromAddress(address(this));
        if (shopVaddr != bytes32(0) && evvm.accountExists(shopVaddr)) {
            revert ShopAlreadyRegistered();
        }
        
        bytes32 generatedVaddr = evvm.generateVaddrFromAddress(address(this), bytes32(0));
        if (evvm.accountExists(generatedVaddr)) {
            revert ShopAlreadyRegistered();
        }
        
        evvm.registerAccountFromAddress(address(this), initialBalance, inputProof);
    }

    // ============ Admin Functions ============
    
    /// @notice Sets the price of a coffee type
    function setCoffeePrice(string memory coffeeType, uint256 price) external onlyOwner {
        require(bytes(coffeeType).length > 0, "EVVMCafe: empty coffee type");
        coffeePrices[coffeeType] = price;
    }
    
    /// @notice Updates the shop owner address
    function setShopOwner(address newOwner) external onlyOwner {
        require(newOwner != address(0), "EVVMCafe: invalid owner");
        ownerOfShop = newOwner;
    }

    // ============ Internal Functions ============
    
    /// @notice Internal check if shop is registered
    function _isShopRegistered() internal view returns (bool) {
        bytes32 shopVaddr = evvm.getVaddrFromAddress(address(this));
        if (shopVaddr != bytes32(0)) {
            return evvm.accountExists(shopVaddr);
        }
        bytes32 generatedVaddr = evvm.generateVaddrFromAddress(address(this), bytes32(0));
        return evvm.accountExists(generatedVaddr);
    }

    /// @notice Override fisher reward to implement actual token transfer
    /// @dev In production, this would transfer tokens from shop balance to fisher
    /// @dev For MVP, we just emit the event (inherited from FheEvvmService)
    function _rewardFisher(address fisher, uint256 amount) internal override {
        // For MVP: Just emit event (base contract handles this)
        // Future: Transfer tokens from priority fee pool to fisher
        super._rewardFisher(fisher, amount);
    }
}
