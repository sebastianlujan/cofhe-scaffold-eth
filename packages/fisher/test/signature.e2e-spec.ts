/**
 * E2E Signature Validation Tests for Fisher Relayer
 *
 * These tests verify that the Fisher's signature validation correctly
 * accepts valid signatures and rejects invalid ones BEFORE submitting
 * to the blockchain (saving gas).
 *
 * The tests ensure the message format matches the smart contract's
 * _buildOrderMessage() exactly.
 *
 * EIP-191 Message Format:
 * "{serviceId},orderCoffee,{client},{coffeeType},{quantity},{serviceNonce},{amountCommitment},{evvmNonce},{deadline},{priorityFee}"
 */

import { createWalletClient, http, keccak256, type Hex, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';
import {
  buildOrderMessage,
  verifyEIP191Signature,
  verifyAmountCommitment,
  isDeadlineValid,
  getTimeUntilDeadline,
  validateOrder,
  type OrderMessageParams,
} from '../src/utils/signature';

// ============ Test Configuration ============

// Hardhat test account #0 (DO NOT USE IN PRODUCTION)
const TEST_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;
const testAccount = privateKeyToAccount(TEST_PRIVATE_KEY);

// Second test account for "wrong signer" tests (Hardhat account #1)
const WRONG_SIGNER_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as Hex;
const wrongSignerAccount = privateKeyToAccount(WRONG_SIGNER_KEY);

// Create wallet clients for signing
const walletClient = createWalletClient({
  account: testAccount,
  chain: mainnet,
  transport: http(),
});

const wrongSignerWallet = createWalletClient({
  account: wrongSignerAccount,
  chain: mainnet,
  transport: http(),
});

// ============ Test Helpers ============

/**
 * Signs a message using EIP-191 personal sign
 */
async function signMessage(message: string, useWrongSigner = false): Promise<Hex> {
  const client = useWrongSigner ? wrongSignerWallet : walletClient;
  return client.signMessage({ message });
}

/**
 * Creates a mock encrypted amount handle (simulates FHE ciphertext handle)
 */
function createMockEncryptedHandle(seed?: string): Hex {
  const data = seed || `test-handle-${Date.now()}-${Math.random()}`;
  return keccak256(`0x${Buffer.from(data).toString('hex')}` as Hex);
}

/**
 * Creates valid order parameters with optional overrides
 */
function createValidOrderParams(
  overrides: Partial<OrderMessageParams> = {},
): OrderMessageParams & { encryptedHandle: Hex } {
  const encryptedHandle = createMockEncryptedHandle();
  const amountCommitment = keccak256(encryptedHandle);

  return {
    client: testAccount.address,
    coffeeType: 'espresso',
    quantity: '2',
    serviceNonce: '1',
    amountCommitment,
    evvmNonce: '0',
    deadline: String(Math.floor(Date.now() / 1000) + 300), // 5 minutes from now
    priorityFee: '1',
    encryptedHandle,
    ...overrides,
  };
}

/**
 * Creates a complete signed order for testing
 */
async function createSignedOrder(
  overrides: Partial<OrderMessageParams> = {},
  useWrongSigner = false,
): Promise<{
  params: OrderMessageParams;
  encryptedHandle: Hex;
  message: string;
  signature: Hex;
}> {
  const { encryptedHandle, ...params } = createValidOrderParams(overrides);
  const message = buildOrderMessage(params);
  const signature = await signMessage(message, useWrongSigner);

  return { params, encryptedHandle, message, signature };
}

// ============ E2E Tests ============

describe('Signature Validation E2E', () => {
  // ============ Message Building Tests ============

  describe('Message Building', () => {
    it('should match contract message format exactly', () => {
      // These exact values should produce a known message string
      const params: OrderMessageParams = {
        client: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        coffeeType: 'latte',
        quantity: '1',
        serviceNonce: '42',
        amountCommitment:
          '0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba',
        evvmNonce: '5',
        deadline: '1704067200',
        priorityFee: '2',
      };

      const message = buildOrderMessage(params);

      // This is the EXACT format the contract expects
      // Contract: FheEvvmService.sol _buildOrderMessage()
      const expected =
        '1,orderCoffee,0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266,latte,1,42,0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba,5,1704067200,2';

      expect(message).toBe(expected);
    });

    it('should convert client address to lowercase', () => {
      const params: OrderMessageParams = {
        client: '0xF39FD6E51AAD88F6F4CE6AB8827279CFFFB92266', // ALL CAPS
        coffeeType: 'espresso',
        quantity: '1',
        serviceNonce: '1',
        amountCommitment: '0xabcd',
        evvmNonce: '0',
        deadline: '1704067200',
        priorityFee: '1',
      };

      const message = buildOrderMessage(params);

      // Should contain lowercase address
      expect(message).toContain('0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266');
      // Should NOT contain uppercase
      expect(message).not.toContain('0xF39FD6E51AAD88F6F4CE6AB8827279CFFFB92266');
    });

    it('should convert amountCommitment to lowercase', () => {
      const params: OrderMessageParams = {
        client: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
        coffeeType: 'espresso',
        quantity: '1',
        serviceNonce: '1',
        amountCommitment: '0xABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890',
        evvmNonce: '0',
        deadline: '1704067200',
        priorityFee: '1',
      };

      const message = buildOrderMessage(params);

      expect(message).toContain(
        '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      );
    });

    it('should include serviceId=1 as first component', () => {
      const { encryptedHandle, ...params } = createValidOrderParams();
      const message = buildOrderMessage(params);

      expect(message.startsWith('1,')).toBe(true);
    });

    it('should include orderCoffee as function identifier', () => {
      const { encryptedHandle, ...params } = createValidOrderParams();
      const message = buildOrderMessage(params);

      expect(message).toContain(',orderCoffee,');
    });

    it('should handle all supported coffee types', () => {
      const coffeeTypes = ['espresso', 'latte', 'cappuccino', 'americano'];

      for (const coffeeType of coffeeTypes) {
        const { encryptedHandle, ...params } = createValidOrderParams({ coffeeType });
        const message = buildOrderMessage(params);

        expect(message).toContain(`,${coffeeType},`);
      }
    });

    it('should handle large numbers correctly', () => {
      const params: OrderMessageParams = {
        client: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
        coffeeType: 'espresso',
        quantity: '999999999',
        serviceNonce: '18446744073709551615', // Max uint64
        amountCommitment: '0x' + 'f'.repeat(64),
        evvmNonce: '18446744073709551615',
        deadline: '9999999999999',
        priorityFee: '999999999999999999',
      };

      const message = buildOrderMessage(params);

      expect(message).toContain('999999999');
      expect(message).toContain('18446744073709551615');
    });
  });

  // ============ Valid Signature Flow Tests ============

  describe('Valid Signature Flow', () => {
    it('should accept correctly signed order', async () => {
      const { params, encryptedHandle, message, signature } = await createSignedOrder();

      const isValid = await verifyEIP191Signature(
        message,
        signature,
        testAccount.address,
      );

      expect(isValid).toBe(true);
    });

    it('should verify signer matches client address', async () => {
      const { params, encryptedHandle, signature } = await createSignedOrder({
        client: testAccount.address,
      });

      const result = await validateOrder(params, signature, encryptedHandle);

      expect(result.valid).toBe(true);
      expect(result.details?.signatureValid).toBe(true);
    });

    it('should pass full validation for complete valid order', async () => {
      const { params, encryptedHandle, signature } = await createSignedOrder();

      const result = await validateOrder(params, signature, encryptedHandle);

      expect(result.valid).toBe(true);
      expect(result.details).toEqual({
        deadlineValid: true,
        commitmentValid: true,
        signatureValid: true,
        quantityValid: true,
        priorityFeeValid: true,
      });
    });

    it('should accept signature with 0 priority fee when minimum is 0', async () => {
      const { params, encryptedHandle, signature } = await createSignedOrder({
        priorityFee: '0',
      });

      const result = await validateOrder(params, signature, encryptedHandle, 0n);

      expect(result.valid).toBe(true);
    });
  });

  // ============ Invalid Signature Rejection Tests ============

  describe('Invalid Signature Rejection', () => {
    it('should reject signature from wrong account', async () => {
      // Sign with wrong account but claim correct client
      const { params, encryptedHandle, signature } = await createSignedOrder(
        { client: testAccount.address },
        true, // Use wrong signer
      );

      const result = await validateOrder(params, signature, encryptedHandle);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid signature');
      expect(result.details?.signatureValid).toBe(false);
    });

    it('should reject when message is tampered - quantity changed', async () => {
      const { params, encryptedHandle, message, signature } = await createSignedOrder({
        quantity: '2',
      });

      // Tamper with quantity after signing
      const tamperedParams = { ...params, quantity: '5' };

      const result = await validateOrder(tamperedParams, signature, encryptedHandle);

      expect(result.valid).toBe(false);
      expect(result.details?.signatureValid).toBe(false);
    });

    it('should reject when message is tampered - coffeeType changed', async () => {
      const { params, encryptedHandle, signature } = await createSignedOrder({
        coffeeType: 'espresso',
      });

      // Tamper with coffee type after signing
      const tamperedParams = { ...params, coffeeType: 'latte' };

      const result = await validateOrder(tamperedParams, signature, encryptedHandle);

      expect(result.valid).toBe(false);
      expect(result.details?.signatureValid).toBe(false);
    });

    it('should reject when message is tampered - deadline changed', async () => {
      const originalDeadline = String(Math.floor(Date.now() / 1000) + 300);
      const { params, encryptedHandle, signature } = await createSignedOrder({
        deadline: originalDeadline,
      });

      // Tamper with deadline (extend it)
      const tamperedParams = {
        ...params,
        deadline: String(Math.floor(Date.now() / 1000) + 600),
      };

      const result = await validateOrder(tamperedParams, signature, encryptedHandle);

      expect(result.valid).toBe(false);
      expect(result.details?.signatureValid).toBe(false);
    });

    it('should reject when message is tampered - priorityFee changed', async () => {
      const { params, encryptedHandle, signature } = await createSignedOrder({
        priorityFee: '1',
      });

      // Tamper with priority fee
      const tamperedParams = { ...params, priorityFee: '0' };

      const result = await validateOrder(tamperedParams, signature, encryptedHandle);

      expect(result.valid).toBe(false);
      expect(result.details?.signatureValid).toBe(false);
    });

    it('should reject malformed signature - too short', async () => {
      const { params, encryptedHandle } = await createSignedOrder();

      const malformedSignature = '0x1234' as Hex;

      const result = await validateOrder(params, malformedSignature, encryptedHandle);

      expect(result.valid).toBe(false);
      expect(result.details?.signatureValid).toBe(false);
    });

    it('should reject malformed signature - invalid bytes', async () => {
      const { params, encryptedHandle } = await createSignedOrder();

      // 65 bytes of zeros - invalid signature
      const invalidSignature = ('0x' + '00'.repeat(65)) as Hex;

      const result = await validateOrder(params, invalidSignature, encryptedHandle);

      expect(result.valid).toBe(false);
      expect(result.details?.signatureValid).toBe(false);
    });

    it('should reject when client address differs from signer', async () => {
      // Create order where client is different from actual signer
      const { params, encryptedHandle, signature } = await createSignedOrder({
        client: wrongSignerAccount.address, // Client is account #1
      });
      // But signature is from account #0 (testAccount)

      const result = await validateOrder(params, signature, encryptedHandle);

      expect(result.valid).toBe(false);
      expect(result.details?.signatureValid).toBe(false);
    });
  });

  // ============ Deadline Validation Tests ============

  describe('Deadline Validation', () => {
    it('should accept deadline 5 minutes in the future', async () => {
      const futureDeadline = String(Math.floor(Date.now() / 1000) + 300);
      const { params, encryptedHandle, signature } = await createSignedOrder({
        deadline: futureDeadline,
      });

      const result = await validateOrder(params, signature, encryptedHandle);

      expect(result.valid).toBe(true);
      expect(result.details?.deadlineValid).toBe(true);
    });

    it('should accept deadline 1 hour in the future', async () => {
      const futureDeadline = String(Math.floor(Date.now() / 1000) + 3600);
      const { params, encryptedHandle, signature } = await createSignedOrder({
        deadline: futureDeadline,
      });

      const result = await validateOrder(params, signature, encryptedHandle);

      expect(result.valid).toBe(true);
      expect(result.details?.deadlineValid).toBe(true);
    });

    it('should reject deadline in the past', async () => {
      const pastDeadline = String(Math.floor(Date.now() / 1000) - 100);
      const { params, encryptedHandle, signature } = await createSignedOrder({
        deadline: pastDeadline,
      });

      const result = await validateOrder(params, signature, encryptedHandle);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('expired');
      expect(result.details?.deadlineValid).toBe(false);
    });

    it('should reject deadline at current timestamp', async () => {
      const nowDeadline = String(Math.floor(Date.now() / 1000));
      const { params, encryptedHandle, signature } = await createSignedOrder({
        deadline: nowDeadline,
      });

      // Small delay to ensure we're past the deadline
      await new Promise((resolve) => setTimeout(resolve, 1100));

      const result = await validateOrder(params, signature, encryptedHandle);

      expect(result.valid).toBe(false);
      expect(result.details?.deadlineValid).toBe(false);
    });

    it('should correctly calculate time until deadline', () => {
      const futureDeadline = BigInt(Math.floor(Date.now() / 1000) + 300);
      const remaining = getTimeUntilDeadline(futureDeadline);

      expect(remaining).toBeGreaterThan(298);
      expect(remaining).toBeLessThanOrEqual(300);
    });

    it('should return negative time for past deadline', () => {
      const pastDeadline = BigInt(Math.floor(Date.now() / 1000) - 100);
      const remaining = getTimeUntilDeadline(pastDeadline);

      expect(remaining).toBeLessThan(0);
    });

    it('should use isDeadlineValid correctly', () => {
      const future = BigInt(Math.floor(Date.now() / 1000) + 300);
      const past = BigInt(Math.floor(Date.now() / 1000) - 100);

      expect(isDeadlineValid(future)).toBe(true);
      expect(isDeadlineValid(past)).toBe(false);
    });
  });

  // ============ Amount Commitment Validation Tests ============

  describe('Amount Commitment Validation', () => {
    it('should accept matching commitment', () => {
      const encryptedHandle = createMockEncryptedHandle('test-seed');
      const correctCommitment = keccak256(encryptedHandle);

      const isValid = verifyAmountCommitment(correctCommitment, encryptedHandle);

      expect(isValid).toBe(true);
    });

    it('should reject mismatched commitment', () => {
      const encryptedHandle = createMockEncryptedHandle('test-seed');
      const wrongCommitment = keccak256(createMockEncryptedHandle('different-seed'));

      const isValid = verifyAmountCommitment(wrongCommitment, encryptedHandle);

      expect(isValid).toBe(false);
    });

    it('should reject zero commitment', () => {
      const encryptedHandle = createMockEncryptedHandle();
      const zeroCommitment = ('0x' + '00'.repeat(32)) as Hex;

      const isValid = verifyAmountCommitment(zeroCommitment, encryptedHandle);

      expect(isValid).toBe(false);
    });

    it('should be case-insensitive for commitment comparison', () => {
      const encryptedHandle = createMockEncryptedHandle('case-test');
      const commitment = keccak256(encryptedHandle);
      const upperCommitment = commitment.toUpperCase() as Hex;

      const isValid = verifyAmountCommitment(upperCommitment, encryptedHandle);

      expect(isValid).toBe(true);
    });

    it('should fail validation when commitment does not match encrypted amount', async () => {
      const encryptedHandle = createMockEncryptedHandle('original');
      const wrongCommitment = keccak256(createMockEncryptedHandle('different'));

      const params = createValidOrderParams({
        amountCommitment: wrongCommitment,
      });
      delete (params as any).encryptedHandle;

      const message = buildOrderMessage(params);
      const signature = await signMessage(message);

      const result = await validateOrder(
        params,
        signature,
        encryptedHandle, // Different from what commitment was built from
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Amount verification');
      expect(result.details?.commitmentValid).toBe(false);
    });
  });

  // ============ Priority Fee Validation Tests ============

  describe('Priority Fee Validation', () => {
    it('should accept fee equal to minimum', async () => {
      const { params, encryptedHandle, signature } = await createSignedOrder({
        priorityFee: '5',
      });

      const result = await validateOrder(params, signature, encryptedHandle, 5n);

      expect(result.valid).toBe(true);
      expect(result.details?.priorityFeeValid).toBe(true);
    });

    it('should accept fee greater than minimum', async () => {
      const { params, encryptedHandle, signature } = await createSignedOrder({
        priorityFee: '10',
      });

      const result = await validateOrder(params, signature, encryptedHandle, 5n);

      expect(result.valid).toBe(true);
      expect(result.details?.priorityFeeValid).toBe(true);
    });

    it('should reject fee less than minimum', async () => {
      const { params, encryptedHandle, signature } = await createSignedOrder({
        priorityFee: '2',
      });

      const result = await validateOrder(params, signature, encryptedHandle, 5n);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Priority fee');
      expect(result.details?.priorityFeeValid).toBe(false);
    });

    it('should accept zero fee when minimum is zero', async () => {
      const { params, encryptedHandle, signature } = await createSignedOrder({
        priorityFee: '0',
      });

      const result = await validateOrder(params, signature, encryptedHandle, 0n);

      expect(result.valid).toBe(true);
    });
  });

  // ============ Quantity Validation Tests ============

  describe('Quantity Validation', () => {
    it('should accept positive quantity', async () => {
      const { params, encryptedHandle, signature } = await createSignedOrder({
        quantity: '5',
      });

      const result = await validateOrder(params, signature, encryptedHandle);

      expect(result.valid).toBe(true);
      expect(result.details?.quantityValid).toBe(true);
    });

    it('should reject zero quantity', async () => {
      const { params, encryptedHandle, signature } = await createSignedOrder({
        quantity: '0',
      });

      const result = await validateOrder(params, signature, encryptedHandle);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('quantity');
      expect(result.details?.quantityValid).toBe(false);
    });

    it('should accept large quantity', async () => {
      const { params, encryptedHandle, signature } = await createSignedOrder({
        quantity: '999999',
      });

      const result = await validateOrder(params, signature, encryptedHandle);

      expect(result.valid).toBe(true);
    });
  });

  // ============ Full Order Validation Flow Tests ============

  describe('Full Order Validation Flow', () => {
    it('should validate all checks in correct order', async () => {
      const { params, encryptedHandle, signature } = await createSignedOrder();

      const result = await validateOrder(params, signature, encryptedHandle);

      // All checks should pass
      expect(result.valid).toBe(true);
      expect(result.details).toBeDefined();
      expect(result.details?.deadlineValid).toBe(true);
      expect(result.details?.commitmentValid).toBe(true);
      expect(result.details?.signatureValid).toBe(true);
      expect(result.details?.quantityValid).toBe(true);
      expect(result.details?.priorityFeeValid).toBe(true);
    });

    it('should fail fast on deadline (first check)', async () => {
      const pastDeadline = String(Math.floor(Date.now() / 1000) - 100);
      const { params, encryptedHandle, signature } = await createSignedOrder({
        deadline: pastDeadline,
      });

      const result = await validateOrder(params, signature, encryptedHandle);

      expect(result.valid).toBe(false);
      expect(result.details?.deadlineValid).toBe(false);
      // Subsequent checks may not have run
    });

    it('should return detailed error information', async () => {
      const { params, encryptedHandle } = await createSignedOrder();
      const invalidSignature = ('0x' + '00'.repeat(65)) as Hex;

      const result = await validateOrder(params, invalidSignature, encryptedHandle);

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.details).toBeDefined();
    });

    it('should handle multiple validation failures gracefully', async () => {
      // Create an order with multiple problems
      const encryptedHandle = createMockEncryptedHandle();
      const params: OrderMessageParams = {
        client: testAccount.address,
        coffeeType: 'espresso',
        quantity: '0', // Invalid
        serviceNonce: '1',
        amountCommitment: ('0x' + '00'.repeat(32)) as Hex, // Won't match
        evvmNonce: '0',
        deadline: String(Math.floor(Date.now() / 1000) - 100), // Expired
        priorityFee: '0',
      };

      const message = buildOrderMessage(params);
      const signature = await signMessage(message);

      // Should fail on first check (deadline)
      const result = await validateOrder(params, signature, encryptedHandle);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('expired');
    });
  });

  // ============ Contract Compatibility Tests ============

  describe('Contract Compatibility', () => {
    it('should produce identical message to contract for known inputs', () => {
      // Test vector that matches contract test in EVVMCafeGasless.test.ts
      const params: OrderMessageParams = {
        client: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
        coffeeType: 'espresso',
        quantity: '2',
        serviceNonce: '1',
        amountCommitment:
          '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        evvmNonce: '0',
        deadline: '1735689600',
        priorityFee: '1',
      };

      const message = buildOrderMessage(params);

      // This exact string should be accepted by the contract
      expect(message).toBe(
        '1,orderCoffee,0x70997970c51812dc3a010c7d01b50e0d17dc79c8,espresso,2,1,0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef,0,1735689600,1',
      );
    });

    it('should format serviceId as "1" (CAFE_SERVICE_ID)', () => {
      const { encryptedHandle, ...params } = createValidOrderParams();
      const message = buildOrderMessage(params);

      const parts = message.split(',');
      expect(parts[0]).toBe('1');
    });

    it('should format function name as "orderCoffee"', () => {
      const { encryptedHandle, ...params } = createValidOrderParams();
      const message = buildOrderMessage(params);

      const parts = message.split(',');
      expect(parts[1]).toBe('orderCoffee');
    });

    it('should have exactly 10 comma-separated components', () => {
      const { encryptedHandle, ...params } = createValidOrderParams();
      const message = buildOrderMessage(params);

      const parts = message.split(',');
      // serviceId, orderCoffee, client, coffeeType, quantity, serviceNonce,
      // amountCommitment, evvmNonce, deadline, priorityFee
      expect(parts.length).toBe(10);
    });

    it('should match frontend eip191Builder format', () => {
      // Simulate what frontend does
      const frontendMessage = [
        '1', // serviceId
        'orderCoffee',
        '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266', // lowercase
        'cappuccino',
        '3',
        '100',
        '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890', // lowercase
        '7',
        '1704067200',
        '5',
      ].join(',');

      // Fisher's buildOrderMessage should produce identical output
      const params: OrderMessageParams = {
        client: '0xF39Fd6e51aad88F6F4ce6aB8827279cffFb92266', // Mixed case input
        coffeeType: 'cappuccino',
        quantity: '3',
        serviceNonce: '100',
        amountCommitment:
          '0xABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890', // Uppercase input
        evvmNonce: '7',
        deadline: '1704067200',
        priorityFee: '5',
      };

      const fisherMessage = buildOrderMessage(params);

      expect(fisherMessage).toBe(frontendMessage);
    });
  });

  // ============ Edge Cases ============

  describe('Edge Cases', () => {
    it('should handle very long coffee type names', async () => {
      const longCoffeeType = 'a'.repeat(100);
      const { encryptedHandle, ...params } = createValidOrderParams({
        coffeeType: longCoffeeType,
      });

      const message = buildOrderMessage(params);

      expect(message).toContain(longCoffeeType);
    });

    it('should handle deadline at Unix epoch', async () => {
      // Deadline of 0 (1970-01-01) should be rejected as expired
      expect(isDeadlineValid(0n)).toBe(false);
    });

    it('should handle maximum uint256 deadline', () => {
      const maxUint256 = BigInt(
        '115792089237316195423570985008687907853269984665640564039457584007913129639935',
      );

      expect(isDeadlineValid(maxUint256)).toBe(true);
    });

    it('should handle empty coffee type', async () => {
      const { encryptedHandle, ...params } = createValidOrderParams({
        coffeeType: '',
      });

      const message = buildOrderMessage(params);

      // Should still produce valid message structure
      expect(message).toContain(',,'); // Empty coffee type between commas
    });
  });
});
