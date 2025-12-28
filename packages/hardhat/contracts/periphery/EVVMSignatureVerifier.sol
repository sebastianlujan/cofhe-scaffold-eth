// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title EVVMSignatureVerifier - Library for EIP-191 Signature Verification
/// @notice Reusable library for signature operations in EVVM
/// @dev Uses OpenZeppelin's ECDSA library for secure signature recovery
library EVVMSignatureVerifier {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    /// @notice EIP-191 signature components
    struct Signature {
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    /// @notice Recovers signer address from EIP-191 signature
    /// @param messageHash The original message hash (before EIP-191 prefix)
    /// @param sig The signature components (v, r, s)
    /// @return signer The recovered Ethereum address
    function recoverSigner(
        bytes32 messageHash,
        Signature memory sig
    ) internal pure returns (address) {
        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();
        return ethSignedHash.recover(abi.encodePacked(sig.r, sig.s, sig.v));
    }

    /// @notice Verifies that a signature was created by the expected signer
    /// @param messageHash The original message hash
    /// @param sig The signature to verify
    /// @param expectedSigner The expected signer address
    /// @return valid True if signature is valid and from expected signer
    function verifySignature(
        bytes32 messageHash,
        Signature memory sig,
        address expectedSigner
    ) internal pure returns (bool) {
        return recoverSigner(messageHash, sig) == expectedSigner;
    }

    /// @notice Creates the transfer message hash for EVVM signed transfers
    /// @param domain The EVVM domain identifier
    /// @param version The signature scheme version
    /// @param fromVaddr Source virtual address
    /// @param toVaddr Destination virtual address
    /// @param amountCommitment Hash commitment to the encrypted amount
    /// @param nonce Transaction nonce
    /// @param deadline Signature expiration timestamp
    /// @param vChainId Virtual chain ID
    /// @param evvmID EVVM instance ID
    /// @param chainId Ethereum chain ID
    /// @param contractAddress Address of the EVVM contract
    /// @return messageHash The hash to be signed
    function createTransferMessageHash(
        bytes32 domain,
        uint8 version,
        bytes32 fromVaddr,
        bytes32 toVaddr,
        bytes32 amountCommitment,
        uint64 nonce,
        uint256 deadline,
        uint64 vChainId,
        uint256 evvmID,
        uint256 chainId,
        address contractAddress
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(
            domain,
            version,
            fromVaddr,
            toVaddr,
            amountCommitment,
            nonce,
            deadline,
            vChainId,
            evvmID,
            chainId,
            contractAddress
        ));
    }

    /// @notice Verifies signature is not expired
    /// @param deadline The signature deadline
    /// @return valid True if signature is still valid
    function isNotExpired(uint256 deadline) internal view returns (bool) {
        return block.timestamp <= deadline;
    }

    /// @notice Creates amount commitment from external encrypted handle
    /// @param amountHandle The external encrypted amount handle (as bytes32)
    /// @return commitment The keccak256 hash commitment
    function createAmountCommitment(bytes32 amountHandle) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(amountHandle));
    }
}
