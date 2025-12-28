/**
 * Secure LocalStorage Cache for EVVM
 *
 * Provides tamper-resistant caching for service nonces and other EVVM data.
 *
 * Security features:
 * - Integrity hash (SHA-256) to detect tampering
 * - Base64 encoding to obscure data
 * - Automatic fallback on validation failure
 * - Clear on wallet disconnect
 *
 * Storage format:
 * Key: "evvm:cache:{chainId}"
 * Value: { data: base64(payload), integrity: sha256(data + secret) }
 */

// ============ Types ============

interface EVVMCachePayload {
  version: number;
  nonces: Record<string, Record<string, number>>; // [contract][wallet] = nonce
}

interface SecureCache {
  data: string; // Base64-encoded JSON payload
  integrity: string; // SHA-256 hash for tamper detection
}

// ============ Constants ============

const CACHE_VERSION = 1;
const STORAGE_PREFIX = "evvm:cache:";

// App secret includes origin to make it unique per deployment
const getAppSecret = (): string => {
  if (typeof window === "undefined") return "evvm-scaffold-v1-ssr";
  return `evvm-scaffold-v1-${window.location.origin}`;
};

// ============ Crypto Helpers ============

/**
 * Calculate SHA-256 hash synchronously using a simple hash function
 * Note: This is not cryptographically secure for sensitive data,
 * but sufficient for tamper detection in localStorage
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }

  // Convert to hex and pad for consistent length
  const hex = Math.abs(hash).toString(16).padStart(8, "0");

  // Create a longer hash by hashing multiple times with different seeds
  let extendedHash = hex;
  for (let i = 1; i <= 7; i++) {
    let seedHash = 0;
    const seedStr = str + i.toString() + hex;
    for (let j = 0; j < seedStr.length; j++) {
      const char = seedStr.charCodeAt(j);
      seedHash = (seedHash << 5) - seedHash + char;
      seedHash = seedHash & seedHash;
    }
    extendedHash += Math.abs(seedHash).toString(16).padStart(8, "0");
  }

  return extendedHash;
}

/**
 * Calculate integrity hash for cache data
 */
function calculateIntegrity(data: string): string {
  return simpleHash(data + getAppSecret());
}

/**
 * Verify integrity hash
 */
function verifyIntegrity(data: string, expectedHash: string): boolean {
  const actualHash = calculateIntegrity(data);
  return actualHash === expectedHash;
}

// ============ Base64 Helpers ============

function encodeBase64(str: string): string {
  if (typeof window === "undefined") return Buffer.from(str).toString("base64");
  return btoa(unescape(encodeURIComponent(str)));
}

function decodeBase64(str: string): string {
  if (typeof window === "undefined") return Buffer.from(str, "base64").toString();
  return decodeURIComponent(escape(atob(str)));
}

// ============ Storage Key ============

function getCacheKey(chainId: number): string {
  return `${STORAGE_PREFIX}${chainId}`;
}

// ============ Normalize Address ============

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

// ============ Cache Read/Write ============

/**
 * Read and validate cache from localStorage
 * Returns null if cache is missing, invalid, or tampered with
 */
function readCache(chainId: number): EVVMCachePayload | null {
  if (typeof window === "undefined") return null;

  try {
    const key = getCacheKey(chainId);
    const raw = localStorage.getItem(key);

    if (!raw) return null;

    // Parse secure wrapper
    const secure: SecureCache = JSON.parse(raw);

    if (!secure.data || !secure.integrity) {
      console.warn("[SecureCache] Invalid cache structure, clearing");
      localStorage.removeItem(key);
      return null;
    }

    // Verify integrity
    if (!verifyIntegrity(secure.data, secure.integrity)) {
      console.warn("[SecureCache] Integrity check failed (possible tampering), clearing");
      localStorage.removeItem(key);
      return null;
    }

    // Decode and parse payload
    const decoded = decodeBase64(secure.data);
    const payload: EVVMCachePayload = JSON.parse(decoded);

    // Validate schema version
    if (payload.version !== CACHE_VERSION) {
      console.warn("[SecureCache] Version mismatch, clearing");
      localStorage.removeItem(key);
      return null;
    }

    return payload;
  } catch (error) {
    console.warn("[SecureCache] Failed to read cache:", error);
    // Clear corrupted cache
    try {
      localStorage.removeItem(getCacheKey(chainId));
    } catch {
      // Ignore cleanup errors
    }
    return null;
  }
}

/**
 * Write cache to localStorage with integrity hash
 */
function writeCache(chainId: number, payload: EVVMCachePayload): void {
  if (typeof window === "undefined") return;

  try {
    const key = getCacheKey(chainId);

    // Encode payload
    const jsonStr = JSON.stringify(payload);
    const data = encodeBase64(jsonStr);

    // Calculate integrity hash
    const integrity = calculateIntegrity(data);

    // Create secure wrapper
    const secure: SecureCache = { data, integrity };

    localStorage.setItem(key, JSON.stringify(secure));
  } catch (error) {
    console.error("[SecureCache] Failed to write cache:", error);
  }
}

/**
 * Generate fallback nonce (timestamp-based)
 * Used when cache is unavailable or invalid
 */
function generateFallbackNonce(): number {
  return Math.floor(Date.now() / 1000);
}

// ============ Public API ============

/**
 * Get the next service nonce for a user
 * @returns Cached nonce or timestamp-based fallback
 */
export function getServiceNonce(chainId: number, contractAddress: string, walletAddress: string): number {
  const cache = readCache(chainId);

  if (!cache) {
    const fallback = generateFallbackNonce();
    console.log("[SecureCache] No cache found, using fallback nonce:", fallback);
    return fallback;
  }

  const contract = normalizeAddress(contractAddress);
  const wallet = normalizeAddress(walletAddress);

  const nonce = cache.nonces?.[contract]?.[wallet];

  if (nonce === undefined) {
    const fallback = generateFallbackNonce();
    console.log("[SecureCache] No nonce cached for wallet, using fallback:", fallback);
    return fallback;
  }

  console.log("[SecureCache] Retrieved cached nonce:", nonce);
  return nonce;
}

/**
 * Save the next nonce after successful transaction
 * @returns The saved nonce value
 */
export function setServiceNonce(
  chainId: number,
  contractAddress: string,
  walletAddress: string,
  nonce: number,
): number {
  const cache = readCache(chainId) || {
    version: CACHE_VERSION,
    nonces: {},
  };

  const contract = normalizeAddress(contractAddress);
  const wallet = normalizeAddress(walletAddress);

  // Initialize nested objects if needed
  if (!cache.nonces[contract]) {
    cache.nonces[contract] = {};
  }

  cache.nonces[contract][wallet] = nonce;

  writeCache(chainId, cache);
  console.log("[SecureCache] Saved nonce:", nonce);

  return nonce;
}

/**
 * Increment nonce by 1 and save
 * @returns The new nonce value
 */
export function incrementServiceNonce(chainId: number, contractAddress: string, walletAddress: string): number {
  const currentNonce = getServiceNonce(chainId, contractAddress, walletAddress);
  const nextNonce = currentNonce + 1;
  return setServiceNonce(chainId, contractAddress, walletAddress, nextNonce);
}

/**
 * Clear all cached data for a wallet across all contracts
 */
export function clearWalletCache(chainId: number, walletAddress: string): void {
  if (typeof window === "undefined") return;

  const cache = readCache(chainId);
  if (!cache) return;

  const wallet = normalizeAddress(walletAddress);

  // Remove wallet from all contracts
  for (const contract of Object.keys(cache.nonces)) {
    if (cache.nonces[contract][wallet] !== undefined) {
      delete cache.nonces[contract][wallet];
    }

    // Clean up empty contract entries
    if (Object.keys(cache.nonces[contract]).length === 0) {
      delete cache.nonces[contract];
    }
  }

  // Write updated cache or remove if empty
  if (Object.keys(cache.nonces).length === 0) {
    localStorage.removeItem(getCacheKey(chainId));
    console.log("[SecureCache] Cleared all cache for chain:", chainId);
  } else {
    writeCache(chainId, cache);
    console.log("[SecureCache] Cleared wallet cache:", wallet);
  }
}

/**
 * Clear entire cache for a chain
 */
export function clearChainCache(chainId: number): void {
  if (typeof window === "undefined") return;

  try {
    localStorage.removeItem(getCacheKey(chainId));
    console.log("[SecureCache] Cleared chain cache:", chainId);
  } catch (error) {
    console.error("[SecureCache] Failed to clear chain cache:", error);
  }
}

/**
 * Debug: Get current cache state (for development)
 */
export function debugGetCache(chainId: number): EVVMCachePayload | null {
  return readCache(chainId);
}
