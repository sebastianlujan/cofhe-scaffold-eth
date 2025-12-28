// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title FheEvvmServiceTypes - EIP-712 Type Definitions for EVVM Services
/// @notice Contains struct definitions and type hashes for gasless EVVM service operations
/// @dev All services using FheEvvmService should import types from here

// ============ Coffee Order Types (EVVMCafe) ============

/// @notice EIP-712 typed data for a gasless coffee order
/// @dev All fields are signed by the user, fisher executes on their behalf
/// @param client The customer address placing the order
/// @param coffeeType Type of coffee (e.g., "espresso", "latte")
/// @param quantity Number of items to order
/// @param serviceNonce Unique nonce for this service call (async - any unused value)
/// @param amountCommitment keccak256 hash of the encrypted payment amount handle
/// @param evvmNonce The EVVM nonce for the payment transaction
/// @param deadline Timestamp after which the signature expires
/// @param priorityFee Amount to reward the fisher for execution (in tokens)
struct CoffeeOrderRequest {
    address client;
    string coffeeType;
    uint256 quantity;
    uint256 serviceNonce;
    bytes32 amountCommitment;
    uint64 evvmNonce;
    uint256 deadline;
    uint256 priorityFee;
}

// EIP-712 typehash for CoffeeOrderRequest
// keccak256("CoffeeOrder(address client,string coffeeType,uint256 quantity,uint256 serviceNonce,bytes32 amountCommitment,uint64 evvmNonce,uint256 deadline,uint256 priorityFee)")
bytes32 constant COFFEE_ORDER_TYPEHASH = keccak256(
    "CoffeeOrder(address client,string coffeeType,uint256 quantity,uint256 serviceNonce,bytes32 amountCommitment,uint64 evvmNonce,uint256 deadline,uint256 priorityFee)"
);

// ============ Generic Service Request Types ============

/// @notice Generic EIP-712 typed data for a gasless payment request
/// @dev Can be used by any service that only needs to process a payment
/// @param from The payer address
/// @param to The payee address
/// @param serviceNonce Unique nonce for this service call
/// @param amountCommitment keccak256 hash of the encrypted payment amount handle
/// @param evvmNonce The EVVM nonce for the payment transaction
/// @param deadline Timestamp after which the signature expires
/// @param priorityFee Amount to reward the fisher for execution
struct PaymentRequest {
    address from;
    address to;
    uint256 serviceNonce;
    bytes32 amountCommitment;
    uint64 evvmNonce;
    uint256 deadline;
    uint256 priorityFee;
}

// EIP-712 typehash for PaymentRequest
bytes32 constant PAYMENT_REQUEST_TYPEHASH = keccak256(
    "PaymentRequest(address from,address to,uint256 serviceNonce,bytes32 amountCommitment,uint64 evvmNonce,uint256 deadline,uint256 priorityFee)"
);

// ============ Helper Library ============

/// @title FheEvvmServiceTypesLib
/// @notice Library for computing EIP-712 struct hashes
library FheEvvmServiceTypesLib {
    
    /// @notice Computes the EIP-712 struct hash for a CoffeeOrderRequest
    /// @param request The coffee order request
    /// @return structHash The keccak256 hash of the encoded struct
    function hashCoffeeOrder(CoffeeOrderRequest calldata request) 
        internal 
        pure 
        returns (bytes32 structHash) 
    {
        return keccak256(abi.encode(
            COFFEE_ORDER_TYPEHASH,
            request.client,
            keccak256(bytes(request.coffeeType)),
            request.quantity,
            request.serviceNonce,
            request.amountCommitment,
            request.evvmNonce,
            request.deadline,
            request.priorityFee
        ));
    }

    /// @notice Computes the EIP-712 struct hash for a PaymentRequest
    /// @param request The payment request
    /// @return structHash The keccak256 hash of the encoded struct
    function hashPaymentRequest(PaymentRequest calldata request) 
        internal 
        pure 
        returns (bytes32 structHash) 
    {
        return keccak256(abi.encode(
            PAYMENT_REQUEST_TYPEHASH,
            request.from,
            request.to,
            request.serviceNonce,
            request.amountCommitment,
            request.evvmNonce,
            request.deadline,
            request.priorityFee
        ));
    }
}
