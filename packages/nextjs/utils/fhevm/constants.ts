/**
 * Zama FHEVM Relayer SDK CDN URL
 *
 * Using CDN loading to avoid SSR issues with the SDK
 * (SDK uses `self` which doesn't exist during server-side rendering)
 */
export const SDK_CDN_URL = "https://cdn.zama.org/relayer-sdk-js/0.3.0-5/relayer-sdk-js.umd.cjs";

/**
 * Sepolia chain ID
 */
export const SEPOLIA_CHAIN_ID = 11155111;
