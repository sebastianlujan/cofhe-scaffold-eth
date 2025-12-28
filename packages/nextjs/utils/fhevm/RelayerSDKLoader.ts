/**
 * RelayerSDKLoader - Dynamic CDN loader for Zama FHEVM Relayer SDK
 *
 * This loader injects a <script> tag to load the SDK from CDN at runtime,
 * avoiding SSR issues where `self` is not defined during server-side rendering.
 *
 * Adapted from: packages/dapps/packages/fhevm-sdk/src/internal/RelayerSDKLoader.ts
 */
import { SDK_CDN_URL } from "./constants";
import { FhevmWindowType, isFhevmWindow } from "./fhevmTypes";

/**
 * Check if code is running in browser environment
 */
export function isBrowser(): boolean {
  return typeof window !== "undefined";
}

/**
 * Check if SDK is already loaded in window
 */
export function isSDKLoaded(): boolean {
  if (!isBrowser()) return false;
  return isFhevmWindow(window);
}

/**
 * Get the relayerSDK from window (throws if not loaded)
 */
export function getRelayerSDK(): FhevmWindowType["relayerSDK"] {
  if (!isBrowser()) {
    throw new Error("RelayerSDKLoader: Cannot access SDK outside browser environment");
  }
  if (!isFhevmWindow(window)) {
    throw new Error("RelayerSDKLoader: SDK not loaded. Call loadSDK() first.");
  }
  return window.relayerSDK;
}

/**
 * Load the Zama FHEVM Relayer SDK from CDN
 *
 * This function:
 * 1. Checks if already loaded (returns immediately if so)
 * 2. Injects a <script> tag pointing to the CDN
 * 3. Waits for script to load
 * 4. Validates that window.relayerSDK is available
 *
 * @returns Promise that resolves when SDK is loaded
 * @throws Error if loading fails or SDK is invalid after loading
 */
export function loadSDK(): Promise<void> {
  console.log("[RelayerSDKLoader] loadSDK called");

  // Ensure browser environment
  if (!isBrowser()) {
    console.log("[RelayerSDKLoader] Not in browser, rejecting");
    return Promise.reject(new Error("RelayerSDKLoader: Can only be used in the browser."));
  }

  // Already loaded?
  if (isFhevmWindow(window)) {
    console.log("[RelayerSDKLoader] SDK already loaded");
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    // Check if script tag already exists
    const existingScript = document.querySelector(`script[src="${SDK_CDN_URL}"]`);
    if (existingScript) {
      console.log("[RelayerSDKLoader] Script tag exists, waiting for load...");
      // Script exists but SDK not ready yet - wait for it
      const checkInterval = setInterval(() => {
        if (isFhevmWindow(window)) {
          clearInterval(checkInterval);
          console.log("[RelayerSDKLoader] SDK ready after waiting");
          resolve();
        }
      }, 100);

      // Timeout after 30 seconds
      setTimeout(() => {
        clearInterval(checkInterval);
        if (!isFhevmWindow(window)) {
          reject(new Error("RelayerSDKLoader: Timeout waiting for SDK to load"));
        }
      }, 30000);
      return;
    }

    // Create and inject script tag
    console.log("[RelayerSDKLoader] Creating script tag for CDN:", SDK_CDN_URL);
    const script = document.createElement("script");
    script.src = SDK_CDN_URL;
    script.type = "text/javascript";
    script.async = true;

    script.onload = () => {
      console.log("[RelayerSDKLoader] Script loaded, validating SDK...");
      if (!isFhevmWindow(window)) {
        reject(new Error(`RelayerSDKLoader: Script loaded from ${SDK_CDN_URL} but window.relayerSDK is invalid.`));
        return;
      }
      console.log("[RelayerSDKLoader] SDK validated successfully");
      resolve();
    };

    script.onerror = () => {
      console.error("[RelayerSDKLoader] Failed to load script from CDN");
      reject(new Error(`RelayerSDKLoader: Failed to load SDK from ${SDK_CDN_URL}`));
    };

    console.log("[RelayerSDKLoader] Appending script to document head");
    document.head.appendChild(script);
  });
}

/**
 * Initialize the SDK (must be called after loadSDK)
 *
 * @returns Promise that resolves to true when initialized
 */
export async function initSDK(): Promise<boolean> {
  if (!isBrowser()) {
    throw new Error("RelayerSDKLoader: Cannot initialize SDK outside browser");
  }

  if (!isFhevmWindow(window)) {
    throw new Error("RelayerSDKLoader: SDK not loaded. Call loadSDK() first.");
  }

  // Already initialized?
  if (window.relayerSDK.__initialized__ === true) {
    console.log("[RelayerSDKLoader] SDK already initialized");
    return true;
  }

  console.log("[RelayerSDKLoader] Initializing SDK...");
  const result = await window.relayerSDK.initSDK();
  window.relayerSDK.__initialized__ = result;

  if (!result) {
    throw new Error("RelayerSDKLoader: initSDK() returned false");
  }

  console.log("[RelayerSDKLoader] SDK initialized successfully");
  return true;
}

/**
 * Check if SDK is initialized
 */
export function isSDKInitialized(): boolean {
  if (!isBrowser()) return false;
  if (!isFhevmWindow(window)) return false;
  return window.relayerSDK.__initialized__ === true;
}
