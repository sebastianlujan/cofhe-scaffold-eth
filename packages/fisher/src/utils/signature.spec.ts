/**
 * Signature Verification Tests for Fisher Relayer
 *
 * These tests verify that the Fisher's signature verification logic
 * matches the smart contract's implementation.
 *
 * EIP-191 Message Format:
 * "{serviceId},orderCoffee,{client},{coffeeType},{quantity},{serviceNonce},{amountCommitment},{evvmNonce},{deadline},{priorityFee}"
 */

import {
  createWalletClient,
  http,
  keccak256,
  type Hex,
  type Address,
} from 'viem';
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
} from './signature';

// ============ Test Fixtures ============

// Test private key (DO NOT USE IN PRODUCTION)
const TEST_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const testAccount = privateKeyToAccount(TEST_PRIVATE_KEY);

// Create a wallet client for signing
const walletClient = createWalletClient({
  account: testAccount,
  chain: mainnet,
  transport: http(),
});

/**
 * Signs a message using EIP-191 personal sign
 */
async function signMessage(message: string): Promise<Hex> {
  return walletClient.signMessage({ message });
}

/**
 * Creates a mock encrypted amount handle
 */
function createMockEncryptedHandle(): Hex {
  return keccak256(
    `0x${Buffer.from(`test-handle-${Date.now()}`).toString('hex')}` as Hex,
  );
}

/**
 * Creates a valid order params fixture
 */
function createValidOrderParams(overrides: Partial<OrderMessageParams> = {}): OrderMessageParams {
  const encryptedHandle = createMockEncryptedHandle();
  const amountCommitment = keccak256(encryptedHandle);

  return {
    client: testAccount.address.toLowerCase(),
    coffeeType: 'espresso',
    quantity: '2',
    serviceNonce: '1',
    amountCommitment,
    evvmNonce: '0',
    deadline: String(Math.floor(Date.now() / 1000) + 300), // 5 minutes from now
    priorityFee: '1',
    ...overrides,
  };
}

// ============ Tests ============

describe('Signature Utilities', () => {
  describe('buildOrderMessage', () => {
    it('should build message in correct format', () => {
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

      expect(message).toBe(
        '1,orderCoffee,0x70997970c51812dc3a010c7d01b50e0d17dc79c8,espresso,2,1,0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef,0,1735689600,1',
      );
    });

    it('should convert address to lowercase', () => {
      const params: OrderMessageParams = {
        client: '0x70997970C51812DC3A010C7D01B50E0D17DC79C8', // uppercase
        coffeeType: 'latte',
        quantity: '1',
        serviceNonce: '5',
        amountCommitment: '0xABCDEF',
        evvmNonce: '10',
        deadline: '1735689600',
        priorityFee: '2',
      };

      const message = buildOrderMessage(params);

      expect(message).toContain('0x70997970c51812dc3a010c7d01b50e0d17dc79c8');
      expect(message).not.toContain('0x70997970C51812DC3A010C7D01B50E0D17DC79C8');
    });

    it('should convert amountCommitment to lowercase', () => {
      const params: OrderMessageParams = {
        client: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
        coffeeType: 'americano',
        quantity: '3',
        serviceNonce: '2',
        amountCommitment: '0xABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890',
        evvmNonce: '0',
        deadline: '1735689600',
        priorityFee: '1',
      };

      const message = buildOrderMessage(params);

      expect(message).toContain(
        '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      );
    });

    it('should include service ID as first component', () => {
      const params = createValidOrderParams();
      const message = buildOrderMessage(params);

      expect(message.startsWith('1,')).toBe(true);
    });

    it('should include orderCoffee as function name', () => {
      const params = createValidOrderParams();
      const message = buildOrderMessage(params);

      expect(message).toContain(',orderCoffee,');
    });
  });

  describe('verifyEIP191Signature', () => {
    it('should verify a valid signature', async () => {
      const params = createValidOrderParams({
        client: testAccount.address,
      });
      const message = buildOrderMessage(params);
      const signature = await signMessage(message);

      const isValid = await verifyEIP191Signature(
        message,
        signature,
        testAccount.address,
      );

      expect(isValid).toBe(true);
    });

    it('should reject signature from wrong signer', async () => {
      const params = createValidOrderParams({
        client: testAccount.address,
      });
      const message = buildOrderMessage(params);
      const signature = await signMessage(message);

      // Different address
      const wrongSigner = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address;

      const isValid = await verifyEIP191Signature(message, signature, wrongSigner);

      expect(isValid).toBe(false);
    });

    it('should reject modified message', async () => {
      const params = createValidOrderParams({
        client: testAccount.address,
      });
      const message = buildOrderMessage(params);
      const signature = await signMessage(message);

      // Modify the message
      const modifiedMessage = message.replace('espresso', 'latte');

      const isValid = await verifyEIP191Signature(
        modifiedMessage,
        signature,
        testAccount.address,
      );

      expect(isValid).toBe(false);
    });

    it('should reject invalid signature format', async () => {
      const params = createValidOrderParams({
        client: testAccount.address,
      });
      const message = buildOrderMessage(params);

      const invalidSignature = '0x1234' as Hex;

      const isValid = await verifyEIP191Signature(
        message,
        invalidSignature,
        testAccount.address,
      );

      expect(isValid).toBe(false);
    });

    it('should handle empty message', async () => {
      const signature = await signMessage('');

      const isValid = await verifyEIP191Signature(
        '',
        signature,
        testAccount.address,
      );

      expect(isValid).toBe(true);
    });
  });

  describe('verifyAmountCommitment', () => {
    it('should verify matching commitment', () => {
      const encryptedHandle = createMockEncryptedHandle();
      const commitment = keccak256(encryptedHandle);

      const isValid = verifyAmountCommitment(commitment, encryptedHandle);

      expect(isValid).toBe(true);
    });

    it('should reject mismatched commitment', () => {
      const encryptedHandle = createMockEncryptedHandle();
      const wrongCommitment =
        '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex;

      const isValid = verifyAmountCommitment(wrongCommitment, encryptedHandle);

      expect(isValid).toBe(false);
    });

    it('should be case-insensitive', () => {
      const encryptedHandle =
        '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as Hex;
      const commitment = keccak256(encryptedHandle);
      const upperCommitment = commitment.toUpperCase() as Hex;

      const isValid = verifyAmountCommitment(upperCommitment, encryptedHandle);

      expect(isValid).toBe(true);
    });
  });

  describe('isDeadlineValid', () => {
    it('should return true for future deadline', () => {
      const futureDeadline = BigInt(Math.floor(Date.now() / 1000) + 300);

      expect(isDeadlineValid(futureDeadline)).toBe(true);
    });

    it('should return false for past deadline', () => {
      const pastDeadline = BigInt(Math.floor(Date.now() / 1000) - 100);

      expect(isDeadlineValid(pastDeadline)).toBe(false);
    });

    it('should return false for current timestamp', () => {
      const now = BigInt(Math.floor(Date.now() / 1000));

      expect(isDeadlineValid(now)).toBe(false);
    });

    it('should return true for far future deadline', () => {
      const farFuture = BigInt(Math.floor(Date.now() / 1000) + 86400 * 365);

      expect(isDeadlineValid(farFuture)).toBe(true);
    });
  });

  describe('getTimeUntilDeadline', () => {
    it('should return positive seconds for future deadline', () => {
      const futureDeadline = BigInt(Math.floor(Date.now() / 1000) + 300);

      const remaining = getTimeUntilDeadline(futureDeadline);

      expect(remaining).toBeGreaterThan(298); // Allow 2 second margin
      expect(remaining).toBeLessThanOrEqual(300);
    });

    it('should return negative seconds for past deadline', () => {
      const pastDeadline = BigInt(Math.floor(Date.now() / 1000) - 100);

      const remaining = getTimeUntilDeadline(pastDeadline);

      expect(remaining).toBeLessThan(0);
      expect(remaining).toBeGreaterThanOrEqual(-102);
    });
  });

  describe('validateOrder', () => {
    it('should pass validation for valid order', async () => {
      const encryptedHandle = createMockEncryptedHandle();
      const params = createValidOrderParams({
        client: testAccount.address,
        amountCommitment: keccak256(encryptedHandle),
      });
      const message = buildOrderMessage(params);
      const signature = await signMessage(message);

      const result = await validateOrder(params, signature, encryptedHandle);

      expect(result.valid).toBe(true);
      expect(result.details?.deadlineValid).toBe(true);
      expect(result.details?.commitmentValid).toBe(true);
      expect(result.details?.signatureValid).toBe(true);
      expect(result.details?.quantityValid).toBe(true);
      expect(result.details?.priorityFeeValid).toBe(true);
    });

    it('should fail for expired deadline', async () => {
      const encryptedHandle = createMockEncryptedHandle();
      const params = createValidOrderParams({
        client: testAccount.address,
        amountCommitment: keccak256(encryptedHandle),
        deadline: String(Math.floor(Date.now() / 1000) - 100), // Past
      });
      const message = buildOrderMessage(params);
      const signature = await signMessage(message);

      const result = await validateOrder(params, signature, encryptedHandle);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('expired');
      expect(result.details?.deadlineValid).toBe(false);
    });

    it('should fail for invalid amount commitment', async () => {
      const encryptedHandle = createMockEncryptedHandle();
      const params = createValidOrderParams({
        client: testAccount.address,
        amountCommitment:
          '0x0000000000000000000000000000000000000000000000000000000000000000', // Wrong
      });
      const message = buildOrderMessage(params);
      const signature = await signMessage(message);

      const result = await validateOrder(params, signature, encryptedHandle);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Amount verification');
      expect(result.details?.commitmentValid).toBe(false);
    });

    it('should fail for invalid signature', async () => {
      const encryptedHandle = createMockEncryptedHandle();
      const params = createValidOrderParams({
        client: testAccount.address,
        amountCommitment: keccak256(encryptedHandle),
      });
      const invalidSignature =
        '0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000' as Hex;

      const result = await validateOrder(
        params,
        invalidSignature,
        encryptedHandle,
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid signature');
      expect(result.details?.signatureValid).toBe(false);
    });

    it('should fail for zero quantity', async () => {
      const encryptedHandle = createMockEncryptedHandle();
      const params = createValidOrderParams({
        client: testAccount.address,
        amountCommitment: keccak256(encryptedHandle),
        quantity: '0',
      });
      const message = buildOrderMessage(params);
      const signature = await signMessage(message);

      const result = await validateOrder(params, signature, encryptedHandle);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('quantity');
      expect(result.details?.quantityValid).toBe(false);
    });

    it('should fail for insufficient priority fee', async () => {
      const encryptedHandle = createMockEncryptedHandle();
      const params = createValidOrderParams({
        client: testAccount.address,
        amountCommitment: keccak256(encryptedHandle),
        priorityFee: '0',
      });
      const message = buildOrderMessage(params);
      const signature = await signMessage(message);

      const minPriorityFee = 5n;
      const result = await validateOrder(
        params,
        signature,
        encryptedHandle,
        minPriorityFee,
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Priority fee');
      expect(result.details?.priorityFeeValid).toBe(false);
    });

    it('should pass when priority fee meets minimum', async () => {
      const encryptedHandle = createMockEncryptedHandle();
      const params = createValidOrderParams({
        client: testAccount.address,
        amountCommitment: keccak256(encryptedHandle),
        priorityFee: '10',
      });
      const message = buildOrderMessage(params);
      const signature = await signMessage(message);

      const minPriorityFee = 5n;
      const result = await validateOrder(
        params,
        signature,
        encryptedHandle,
        minPriorityFee,
      );

      expect(result.valid).toBe(true);
      expect(result.details?.priorityFeeValid).toBe(true);
    });

    it('should validate signature against correct signer', async () => {
      const encryptedHandle = createMockEncryptedHandle();
      // Use a different address as the client
      const differentClient =
        '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address;
      const params = createValidOrderParams({
        client: differentClient, // Different from test account
        amountCommitment: keccak256(encryptedHandle),
      });
      const message = buildOrderMessage(params);
      // Sign with test account but claim different client
      const signature = await signMessage(message);

      const result = await validateOrder(params, signature, encryptedHandle);

      // Should fail because signature is from testAccount but client is different
      expect(result.valid).toBe(false);
      expect(result.details?.signatureValid).toBe(false);
    });
  });

  describe('Message Format Compatibility', () => {
    it('should produce message that matches contract format', () => {
      // This test uses exact values to verify format matches contract
      const params: OrderMessageParams = {
        client: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
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

      // Expected format from contract
      const expected =
        '1,orderCoffee,0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266,latte,1,42,0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba,5,1704067200,2';

      expect(message).toBe(expected);
    });

    it('should handle all coffee types', () => {
      const coffeeTypes = ['espresso', 'latte', 'cappuccino', 'americano'];

      for (const coffeeType of coffeeTypes) {
        const params = createValidOrderParams({ coffeeType });
        const message = buildOrderMessage(params);

        expect(message).toContain(`,${coffeeType},`);
      }
    });

    it('should handle large numbers', () => {
      const params: OrderMessageParams = {
        client: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
        coffeeType: 'espresso',
        quantity: '999999999',
        serviceNonce: '18446744073709551615', // Max uint64
        amountCommitment:
          '0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba',
        evvmNonce: '18446744073709551615',
        deadline: '9999999999999',
        priorityFee: '999999999999999999',
      };

      const message = buildOrderMessage(params);

      expect(message).toContain('999999999');
      expect(message).toContain('18446744073709551615');
    });
  });
});
