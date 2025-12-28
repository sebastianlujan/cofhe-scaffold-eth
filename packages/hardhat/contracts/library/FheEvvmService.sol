// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "../core/EVVM.core.sol";

/// @title FheEvvmService - Base Contract for Gasless FHE-Enabled EVVM Services
/// @notice Abstract contract providing gasless transaction helpers with EIP-191 signature support
/// @dev Services inherit this contract to enable gasless operations where users sign and fishers execute
/// 
/// @dev Key Features:
/// - EIP-191 personal sign signature validation (simple comma-separated message format)
/// - Async service nonces (out-of-order execution allowed)
/// - Integrated payment processing via EVVMCore
/// - Fisher reward mechanism
/// 
/// @dev Architecture:
/// ┌─────────┐  sign (no gas)   ┌───────────────┐  pays gas   ┌─────────────────┐
/// │  User   │ ────────────────▶│   Frontend    │ ──────────▶ │ Fisher Relayer  │
/// └─────────┘                   └───────────────┘             └────────┬────────┘
///                                                                       │
///                                                                       ▼
///                                                             ┌─────────────────┐
///                                                             │  EVVM Service   │
///                                                             │ (inherits this) │
///                                                             └────────┬────────┘
///                                                                       │
///                                                                       ▼
///                                                             ┌─────────────────┐
///                                                             │    EVVMCore     │
///                                                             └─────────────────┘
///
/// @dev EIP-191 Message Format:
/// "{serviceId},{functionName},{param1},{param2},...,{paramN}"
/// Example: "1,orderCoffee,0x1234...,espresso,2,1,0x5678...,0,1735689600,1"
abstract contract FheEvvmService is ZamaEthereumConfig {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;
    using Strings for uint256;
    using Strings for address;

    // ============ State Variables ============

    /// @notice Reference to the EVVM Core contract
    EVVMCore public immutable evvm;

    /// @notice Service name for identification
    string public serviceName;

    /// @notice Service version
    string public constant SERVICE_VERSION = "1";

    /// @notice Service ID for EIP-191 messages (like EVVM's evvmId)
    uint256 public immutable serviceId;

    /// @notice Tracks used service nonces per user (async nonces - any unused nonce is valid)
    mapping(address => mapping(uint256 => bool)) private _usedServiceNonces;

    // ============ Events ============

    /// @notice Emitted when a service nonce is used
    /// @param user The user whose nonce was used
    /// @param nonce The nonce that was consumed
    event ServiceNonceUsed(address indexed user, uint256 indexed nonce);

    /// @notice Emitted when a fisher is rewarded
    /// @param fisher The fisher address that received the reward
    /// @param amount The reward amount
    event FisherRewarded(address indexed fisher, uint256 amount);

    /// @notice Emitted when a gasless payment is processed
    /// @param from The payer address
    /// @param to The payee address
    /// @param txId The EVVM transaction ID
    event GaslessPaymentProcessed(address indexed from, address indexed to, uint256 indexed txId);

    // ============ Errors ============

    /// @notice Error when signature is invalid
    error InvalidSignature();

    /// @notice Error when signature has expired
    error SignatureExpired();

    /// @notice Error when service nonce has already been used
    error ServiceNonceAlreadyUsed();

    /// @notice Error when amount commitment doesn't match encrypted input
    error AmountCommitmentMismatch();

    /// @notice Error when user is not registered in EVVM
    error UserNotRegistered();

    // ============ Constructor ============

    /// @notice Initializes the FheEvvmService with EVVM Core reference
    /// @param _evvmAddress Address of the deployed EVVMCore contract
    /// @param _serviceName Name of the service
    /// @param _serviceId Unique service ID for EIP-191 messages
    constructor(address _evvmAddress, string memory _serviceName, uint256 _serviceId) {
        require(_evvmAddress != address(0), "FheEvvmService: invalid EVVM address");
        evvm = EVVMCore(_evvmAddress);
        serviceName = _serviceName;
        serviceId = _serviceId;
    }

    // ============ EIP-191 Signature Validation ============

    /// @notice Validates an EIP-191 personal sign signature
    /// @param message The message that was signed (without EIP-191 prefix)
    /// @param signature The signature bytes (65 bytes: r + s + v)
    /// @param expectedSigner The address that should have signed
    /// @return valid True if the signature is valid
    function _validateEIP191Signature(
        string memory message,
        bytes calldata signature,
        address expectedSigner
    ) internal pure returns (bool valid) {
        // EIP-191: "\x19Ethereum Signed Message:\n" + len(message) + message
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n",
                Strings.toString(bytes(message).length),
                message
            )
        );

        // Recover signer from signature
        address recoveredSigner = messageHash.recover(signature);

        return recoveredSigner == expectedSigner;
    }

    /// @notice Validates signature and reverts if invalid
    /// @param message The message that was signed
    /// @param signature The signature bytes
    /// @param expectedSigner The address that should have signed
    function _requireValidEIP191Signature(
        string memory message,
        bytes calldata signature,
        address expectedSigner
    ) internal pure {
        if (!_validateEIP191Signature(message, signature, expectedSigner)) {
            revert InvalidSignature();
        }
    }

    // ============ Message Building Helpers ============

    /// @notice Converts an address to lowercase hex string (EVVM format)
    /// @param addr The address to convert
    /// @return The lowercase hex string with 0x prefix
    function _addressToString(address addr) internal pure returns (string memory) {
        bytes memory alphabet = "0123456789abcdef";
        bytes memory data = abi.encodePacked(addr);
        bytes memory str = new bytes(42);
        str[0] = '0';
        str[1] = 'x';
        for (uint i = 0; i < 20; i++) {
            str[2 + i * 2] = alphabet[uint(uint8(data[i] >> 4))];
            str[3 + i * 2] = alphabet[uint(uint8(data[i] & 0x0f))];
        }
        return string(str);
    }

    /// @notice Converts bytes32 to hex string
    /// @param data The bytes32 to convert
    /// @return The hex string with 0x prefix
    function _bytes32ToHexString(bytes32 data) internal pure returns (string memory) {
        bytes memory alphabet = "0123456789abcdef";
        bytes memory str = new bytes(66);
        str[0] = '0';
        str[1] = 'x';
        for (uint i = 0; i < 32; i++) {
            str[2 + i * 2] = alphabet[uint(uint8(data[i] >> 4))];
            str[3 + i * 2] = alphabet[uint(uint8(data[i] & 0x0f))];
        }
        return string(str);
    }

    // ============ Service Nonce Management ============

    /// @notice Checks if a service nonce has been used
    /// @param user The user address
    /// @param nonce The nonce to check
    /// @return used True if the nonce has been used
    function isServiceNonceUsed(address user, uint256 nonce) public view returns (bool used) {
        return _usedServiceNonces[user][nonce];
    }

    /// @notice Verifies that a service nonce hasn't been used (reverts if used)
    /// @param user The user address
    /// @param nonce The nonce to verify
    function _verifyServiceNonce(address user, uint256 nonce) internal view {
        if (_usedServiceNonces[user][nonce]) {
            revert ServiceNonceAlreadyUsed();
        }
    }

    /// @notice Marks a service nonce as used
    /// @param user The user address
    /// @param nonce The nonce to mark as used
    function _markServiceNonceUsed(address user, uint256 nonce) internal {
        _usedServiceNonces[user][nonce] = true;
        emit ServiceNonceUsed(user, nonce);
    }

    // ============ Payment Processing ============

    /// @notice Processes a payment through EVVMCore using the caller's authority
    /// @dev The service contract must be trusted to call requestPay on behalf of users
    /// @param from The payer address (must be registered in EVVM)
    /// @param to The payee address (must be registered in EVVM)
    /// @param amount The encrypted payment amount
    /// @param inputProof ZK proof for the encrypted amount
    /// @param evvmNonce The EVVM nonce for the payer's account
    /// @return txId The EVVM transaction ID
    function _processPayment(
        address from,
        address to,
        externalEuint64 amount,
        bytes calldata inputProof,
        uint64 evvmNonce
    ) internal returns (uint256 txId) {
        // Verify both addresses are registered
        if (evvm.getVaddrFromAddress(from) == bytes32(0)) {
            revert UserNotRegistered();
        }
        if (evvm.getVaddrFromAddress(to) == bytes32(0)) {
            revert UserNotRegistered();
        }

        // Process payment through EVVMCore
        txId = evvm.requestPay(from, to, amount, inputProof, evvmNonce);

        emit GaslessPaymentProcessed(from, to, txId);
        return txId;
    }

    // ============ Fisher Rewards ============

    /// @notice Rewards the fisher (msg.sender) for executing the transaction
    /// @dev Override this function to implement custom reward logic
    /// @dev Default implementation does nothing - services can transfer tokens here
    /// @param fisher The fisher address (typically msg.sender)
    /// @param amount The reward amount (in service-defined units)
    function _rewardFisher(address fisher, uint256 amount) internal virtual {
        // Default: emit event only, actual transfer to be implemented by inheriting contract
        if (amount > 0) {
            emit FisherRewarded(fisher, amount);
        }
    }

    // ============ Helper Functions ============

    /// @notice Creates an amount commitment from an encrypted handle
    /// @dev The commitment is keccak256(handle) to bind signature to specific encrypted value
    /// @param amount The external encrypted amount handle
    /// @return commitment The keccak256 hash of the handle
    function _createAmountCommitment(externalEuint64 amount) internal pure returns (bytes32 commitment) {
        return keccak256(abi.encodePacked(externalEuint64.unwrap(amount)));
    }

    /// @notice Verifies that the amount commitment matches the encrypted amount
    /// @param expectedCommitment The commitment from the signed message
    /// @param amount The encrypted amount provided
    function _verifyAmountCommitment(
        bytes32 expectedCommitment,
        externalEuint64 amount
    ) internal pure {
        bytes32 actualCommitment = _createAmountCommitment(amount);
        if (actualCommitment != expectedCommitment) {
            revert AmountCommitmentMismatch();
        }
    }

    /// @notice Gets the EVVM nonce for a user
    /// @param user The user address
    /// @return nonce The current EVVM nonce
    function getEvvmNonce(address user) public view returns (uint64 nonce) {
        bytes32 vaddr = evvm.getVaddrFromAddress(user);
        if (vaddr == bytes32(0)) {
            return 0;
        }
        return evvm.getNonce(vaddr);
    }

    /// @notice Gets the encrypted EVVM balance for a user
    /// @param user The user address
    /// @return balance The encrypted balance handle
    /// @dev Reverts if user is not registered
    function getEvvmBalance(address user) public view returns (euint64 balance) {
        bytes32 vaddr = evvm.getVaddrFromAddress(user);
        require(vaddr != bytes32(0), "FheEvvmService: user not registered");
        return evvm.getEncryptedBalance(vaddr);
    }

    /// @notice Checks if a user is registered in EVVM
    /// @param user The user address
    /// @return registered True if the user is registered
    function isUserRegistered(address user) public view returns (bool registered) {
        return evvm.getVaddrFromAddress(user) != bytes32(0);
    }

    /// @notice Gets the service ID
    /// @return id The service ID
    function getServiceId() external view returns (uint256 id) {
        return serviceId;
    }
}
