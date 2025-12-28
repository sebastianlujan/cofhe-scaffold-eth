/**
 * Custom Validation Errors for Fisher Relayer
 *
 * These error types provide specific error codes and messages for different
 * validation failures, allowing the frontend to show appropriate UI feedback.
 */

import { BadRequestException, HttpStatus } from '@nestjs/common';

/**
 * Error codes for signature validation failures
 * These codes can be used by the frontend to show specific error messages
 */
export enum ValidationErrorCode {
  // Signature errors
  INVALID_SIGNATURE = 'INVALID_SIGNATURE',
  SIGNATURE_EXPIRED = 'SIGNATURE_EXPIRED',
  WRONG_SIGNER = 'WRONG_SIGNER',

  // Amount errors
  AMOUNT_COMMITMENT_MISMATCH = 'AMOUNT_COMMITMENT_MISMATCH',
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',

  // Nonce errors
  SERVICE_NONCE_USED = 'SERVICE_NONCE_USED',
  EVVM_NONCE_MISMATCH = 'EVVM_NONCE_MISMATCH',

  // Order errors
  INVALID_QUANTITY = 'INVALID_QUANTITY',
  INVALID_COFFEE_TYPE = 'INVALID_COFFEE_TYPE',
  PRIORITY_FEE_TOO_LOW = 'PRIORITY_FEE_TOO_LOW',

  // User errors
  USER_NOT_REGISTERED = 'USER_NOT_REGISTERED',
  SHOP_NOT_REGISTERED = 'SHOP_NOT_REGISTERED',

  // Generic
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * Extended error response with error code
 */
export interface ValidationErrorResponse {
  statusCode: number;
  message: string;
  error: string;
  code: ValidationErrorCode;
  details?: Record<string, unknown>;
}

/**
 * Custom exception for validation errors with error codes
 */
export class ValidationException extends BadRequestException {
  public readonly code: ValidationErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: ValidationErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super({
      statusCode: HttpStatus.BAD_REQUEST,
      message,
      error: 'Bad Request',
      code,
      details,
    } as ValidationErrorResponse);

    this.code = code;
    this.details = details;
  }
}

// ============ Pre-built Validation Exceptions ============

/**
 * Thrown when EIP-191 signature is invalid
 */
export class InvalidSignatureException extends ValidationException {
  constructor(details?: Record<string, unknown>) {
    super(
      ValidationErrorCode.INVALID_SIGNATURE,
      'Invalid signature. Please sign again.',
      details,
    );
  }
}

/**
 * Thrown when signature deadline has expired
 */
export class SignatureExpiredException extends ValidationException {
  constructor(deadline: string, details?: Record<string, unknown>) {
    super(
      ValidationErrorCode.SIGNATURE_EXPIRED,
      'Order has expired. Please try again.',
      { deadline, ...details },
    );
  }
}

/**
 * Thrown when amount commitment doesn't match encrypted amount
 */
export class AmountCommitmentMismatchException extends ValidationException {
  constructor(details?: Record<string, unknown>) {
    super(
      ValidationErrorCode.AMOUNT_COMMITMENT_MISMATCH,
      'Amount verification failed.',
      details,
    );
  }
}

/**
 * Thrown when service nonce has already been used
 */
export class ServiceNonceUsedException extends ValidationException {
  constructor(nonce: string, details?: Record<string, unknown>) {
    super(
      ValidationErrorCode.SERVICE_NONCE_USED,
      'This order was already processed. Please refresh and try again.',
      { nonce, ...details },
    );
  }
}

/**
 * Thrown when quantity is invalid (zero or negative)
 */
export class InvalidQuantityException extends ValidationException {
  constructor(quantity: string, details?: Record<string, unknown>) {
    super(
      ValidationErrorCode.INVALID_QUANTITY,
      'Please select a valid quantity.',
      { quantity, ...details },
    );
  }
}

/**
 * Thrown when priority fee is below minimum
 */
export class PriorityFeeTooLowException extends ValidationException {
  constructor(fee: string, minFee: string, details?: Record<string, unknown>) {
    super(
      ValidationErrorCode.PRIORITY_FEE_TOO_LOW,
      `Priority fee must be at least ${minFee}.`,
      { fee, minFee, ...details },
    );
  }
}

/**
 * Thrown when user is not registered in EVVM
 */
export class UserNotRegisteredException extends ValidationException {
  constructor(address: string, details?: Record<string, unknown>) {
    super(
      ValidationErrorCode.USER_NOT_REGISTERED,
      'Please register your account before ordering.',
      { address, ...details },
    );
  }
}

/**
 * Thrown when shop is not registered in EVVM
 */
export class ShopNotRegisteredException extends ValidationException {
  constructor(details?: Record<string, unknown>) {
    super(
      ValidationErrorCode.SHOP_NOT_REGISTERED,
      'The coffee shop is currently unavailable. Please try again later.',
      details,
    );
  }
}

/**
 * Thrown when coffee type is invalid
 */
export class InvalidCoffeeTypeException extends ValidationException {
  constructor(coffeeType: string, details?: Record<string, unknown>) {
    super(
      ValidationErrorCode.INVALID_COFFEE_TYPE,
      'Please select a valid coffee type.',
      { coffeeType, ...details },
    );
  }
}

/**
 * Thrown when user has insufficient balance
 */
export class InsufficientBalanceException extends ValidationException {
  constructor(details?: Record<string, unknown>) {
    super(
      ValidationErrorCode.INSUFFICIENT_BALANCE,
      'Insufficient balance. Please add more funds to your account.',
      details,
    );
  }
}

/**
 * Maps validation result error messages to specific exceptions
 */
export function createValidationException(
  error: string,
  details?: Record<string, unknown>,
): ValidationException {
  const errorLower = error.toLowerCase();

  if (errorLower.includes('expired')) {
    return new SignatureExpiredException(details?.deadline as string, details);
  }
  if (errorLower.includes('signature')) {
    return new InvalidSignatureException(details);
  }
  if (errorLower.includes('amount') || errorLower.includes('commitment')) {
    return new AmountCommitmentMismatchException(details);
  }
  if (errorLower.includes('quantity')) {
    return new InvalidQuantityException(details?.quantity as string, details);
  }
  if (errorLower.includes('priority') || errorLower.includes('fee')) {
    return new PriorityFeeTooLowException(
      details?.fee as string,
      details?.minFee as string,
      details,
    );
  }
  if (errorLower.includes('nonce') && errorLower.includes('used')) {
    return new ServiceNonceUsedException(details?.nonce as string, details);
  }

  // Default validation error
  return new ValidationException(
    ValidationErrorCode.VALIDATION_FAILED,
    error,
    details,
  );
}

/**
 * Maps contract revert errors to specific exceptions
 */
export function mapContractErrorToException(
  errorMessage: string,
): ValidationException {
  if (errorMessage.includes('SignatureExpired')) {
    return new SignatureExpiredException('unknown');
  }
  if (errorMessage.includes('InvalidSignature')) {
    return new InvalidSignatureException();
  }
  if (errorMessage.includes('ServiceNonceUsed') || errorMessage.includes('ServiceNonceAlreadyUsed')) {
    return new ServiceNonceUsedException('unknown');
  }
  if (errorMessage.includes('UserNotRegistered')) {
    return new UserNotRegisteredException('unknown');
  }
  if (errorMessage.includes('ShopNotRegistered')) {
    return new ShopNotRegisteredException();
  }
  if (errorMessage.includes('InsufficientBalance')) {
    return new InsufficientBalanceException();
  }
  if (errorMessage.includes('InvalidQuantity')) {
    return new InvalidQuantityException('unknown');
  }
  if (errorMessage.includes('InvalidCoffeeType')) {
    return new InvalidCoffeeTypeException('unknown');
  }
  if (errorMessage.includes('AmountCommitmentMismatch')) {
    return new AmountCommitmentMismatchException();
  }

  // Generic error
  return new ValidationException(
    ValidationErrorCode.UNKNOWN_ERROR,
    'Unable to process your order. Please try again later.',
  );
}
