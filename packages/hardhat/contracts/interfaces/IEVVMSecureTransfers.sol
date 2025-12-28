// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {IEVVMSignedTransfers} from "./IEVVMSignedTransfers.sol";

/// @title IEVVMSecureTransfers - Interface for Plan 2A Secure Transfers
/// @notice Interface for two-phase challenge-response authentication
/// @dev Provides defense-in-depth with FHE secrets on top of EIP-191 signatures
interface IEVVMSecureTransfers {
    // ============ Structs ============

    /// @notice Pending secure transfer challenge for two-phase FHE authentication
    /// @dev Phase A creates this challenge, Phase B completes it with secret verification
    struct SecureTransferChallenge {
        bytes32 fromVaddr;           // Source account
        bytes32 toVaddr;             // Destination account
        externalEuint64 amount;      // Encrypted amount handle
        bytes inputProof;            // ZK proof for amount
        uint64 expectedNonce;        // Nonce at time of request
        uint256 deadline;            // Signature deadline
        uint256 challengeExpiry;     // Challenge expiration (e.g., 5 minutes)
        bytes32 challengeHash;       // Random challenge for binding
        bool exists;                 // Existence flag
    }

    // ============ Events ============

    /// @notice Emitted when a secure transfer challenge is created (Phase A)
    event SecureTransferRequested(
        bytes32 indexed challengeId,
        bytes32 indexed fromVaddr,
        bytes32 indexed toVaddr,
        uint256 challengeExpiry
    );

    /// @notice Emitted when a secure transfer is completed (Phase B)
    event SecureTransferCompleted(
        bytes32 indexed challengeId,
        bytes32 indexed fromVaddr,
        bytes32 indexed toVaddr,
        uint64 nonce,
        uint256 txId
    );

    /// @notice Emitted when a secure transfer challenge is cancelled
    event SecureTransferCancelled(
        bytes32 indexed challengeId,
        bytes32 indexed fromVaddr,
        string reason
    );

    /// @notice Emitted when account secret is set/updated/disabled
    event AccountSecretUpdated(bytes32 indexed vaddr, bool enabled);

    // ============ Constants ============

    /// @notice Challenge expiration time
    function CHALLENGE_EXPIRY() external view returns (uint256);

    // ============ Secret Management ============

    /// @notice Sets up an encrypted secret for FHE authentication
    /// @dev Only callable by the registered address owner
    /// @param vaddr The virtual address to set secret for
    /// @param secret The encrypted secret value
    /// @param inputProof ZK proof for the encrypted secret
    function setAccountSecret(
        bytes32 vaddr,
        externalEuint64 secret,
        bytes calldata inputProof
    ) external;

    /// @notice Disables FHE secret requirement for an account
    /// @dev Only callable by the registered address owner
    /// @param vaddr The virtual address to disable secret for
    function disableAccountSecret(bytes32 vaddr) external;

    /// @notice Re-enables FHE secret requirement for an account
    /// @dev Only callable by the registered address owner
    /// @param vaddr The virtual address to enable secret for
    function enableAccountSecret(bytes32 vaddr) external;

    /// @notice Checks if an account has FHE secret enabled
    /// @param vaddr The virtual address to check
    /// @return enabled True if FHE secret is enabled
    function hasSecretEnabled(bytes32 vaddr) external view returns (bool);

    // ============ Challenge-Response Functions ============

    /// @notice Phase A: Request a secure transfer (creates challenge)
    /// @dev Verifies signature but does NOT increment nonce
    /// @param fromVaddr Source virtual account
    /// @param toVaddr Destination virtual account
    /// @param amount Encrypted amount handle
    /// @param inputProof ZK proof for amount
    /// @param expectedNonce Nonce at time of request
    /// @param deadline Signature deadline
    /// @param sig EIP-191 signature
    /// @return challengeId Unique identifier for completing the transfer
    function requestSecureTransfer(
        bytes32 fromVaddr,
        bytes32 toVaddr,
        externalEuint64 amount,
        bytes calldata inputProof,
        uint64 expectedNonce,
        uint256 deadline,
        IEVVMSignedTransfers.Signature calldata sig
    ) external returns (bytes32 challengeId);

    /// @notice Phase B: Complete secure transfer (verifies secret)
    /// @dev Only increments nonce if secret is valid
    /// @param challengeId The challenge ID from requestSecureTransfer
    /// @param secret The encrypted secret
    /// @param secretProof ZK proof for the secret
    /// @return txId Transaction ID (0 if secret invalid)
    function completeSecureTransfer(
        bytes32 challengeId,
        externalEuint64 secret,
        bytes calldata secretProof
    ) external returns (uint256 txId);

    /// @notice Cancel an expired or unwanted challenge
    /// @dev Anyone can cancel expired challenges, only owner can cancel valid ones
    /// @param challengeId The challenge ID to cancel
    function cancelSecureTransfer(bytes32 challengeId) external;

    /// @notice Gets challenge information
    /// @param challengeId The challenge ID to query
    /// @return challenge The SecureTransferChallenge struct
    function getSecureTransferChallenge(bytes32 challengeId)
        external
        view
        returns (SecureTransferChallenge memory);
}
