/**
 * EVVMCafeGasless Contract ABI (EIP-191 Version)
 * 
 * This ABI contains only the functions needed by the Fisher relayer.
 * 
 * Function signature for orderCoffeeGasless:
 * orderCoffeeGasless(
 *   address client,
 *   string coffeeType,
 *   uint256 quantity,
 *   uint256 serviceNonce,
 *   bytes32 amountCommitment,
 *   uint64 evvmNonce,
 *   uint256 deadline,
 *   uint256 priorityFee,
 *   bytes32 encryptedAmount,
 *   bytes inputProof,
 *   bytes signature
 * )
 */
export const EVVMCafeGaslessABI = [
  {
    inputs: [
      { internalType: 'address', name: 'client', type: 'address' },
      { internalType: 'string', name: 'coffeeType', type: 'string' },
      { internalType: 'uint256', name: 'quantity', type: 'uint256' },
      { internalType: 'uint256', name: 'serviceNonce', type: 'uint256' },
      { internalType: 'bytes32', name: 'amountCommitment', type: 'bytes32' },
      { internalType: 'uint64', name: 'evvmNonce', type: 'uint64' },
      { internalType: 'uint256', name: 'deadline', type: 'uint256' },
      { internalType: 'uint256', name: 'priorityFee', type: 'uint256' },
      { internalType: 'externalEuint64', name: 'encryptedAmount', type: 'bytes32' },
      { internalType: 'bytes', name: 'inputProof', type: 'bytes' },
      { internalType: 'bytes', name: 'signature', type: 'bytes' },
    ],
    name: 'orderCoffeeGasless',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'isShopRegistered',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'string', name: 'coffeeType', type: 'string' }],
    name: 'getCoffeePrice',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'client', type: 'address' },
      { internalType: 'uint256', name: 'nonce', type: 'uint256' },
    ],
    name: 'isServiceNonceUsed',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'serviceId',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'address', name: 'client', type: 'address' },
      { indexed: false, internalType: 'string', name: 'coffeeType', type: 'string' },
      { indexed: false, internalType: 'uint256', name: 'quantity', type: 'uint256' },
      { indexed: false, internalType: 'uint64', name: 'evvmNonce', type: 'uint64' },
      { indexed: true, internalType: 'address', name: 'fisher', type: 'address' },
      { indexed: false, internalType: 'uint256', name: 'priorityFee', type: 'uint256' },
    ],
    name: 'GaslessCoffeeOrdered',
    type: 'event',
  },
] as const;
