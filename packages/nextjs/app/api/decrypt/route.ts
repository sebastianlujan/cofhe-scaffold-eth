/**
 * Server-Side Decrypt Proxy API
 *
 * This endpoint proxies decryption requests to the Zama FHEVM relayer server-side,
 * bypassing CORS restrictions that affect browser-to-relayer requests.
 *
 * Features:
 * - Server-side proxy (no CORS issues)
 * - Retry logic with exponential backoff
 * - Proper error handling and logging
 *
 * Usage:
 * POST /api/decrypt
 * {
 *   "handles": ["0x..."]
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "clearValues": { "0x...": "12345" }
 * }
 */

import { NextRequest, NextResponse } from "next/server";

// ============ Configuration ============

const ZAMA_RELAYER_URL = "https://relayer.testnet.zama.org/v1/public-decrypt";
const MAX_RETRIES = 3;
const INITIAL_DELAY_MS = 2000;
const MAX_DELAY_MS = 10000;
const REQUEST_TIMEOUT_MS = 30000;

// ============ Types ============

interface DecryptRequest {
  handles: string[];
}

interface ZamaDecryptResponseItem {
  decrypted_value: string;
  signatures: string[];
}

interface ZamaDecryptResponse {
  response?: ZamaDecryptResponseItem[];
  clearValues?: Record<string, string | number | boolean>;
  abiEncodedClearValues?: string;
  decryptionProof?: string;
  error?: {
    message?: string;
    label?: string;
    details?: unknown;
  };
}

// ============ Helpers ============

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    // Retry on timeout, network errors, 5xx errors
    return (
      message.includes("timeout") ||
      message.includes("network") ||
      message.includes("econnrefused") ||
      message.includes("econnreset") ||
      message.includes("504") ||
      message.includes("503") ||
      message.includes("502") ||
      message.includes("relayer didn't respond")
    );
  }
  return false;
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============ Core Decryption Logic ============

async function callZamaRelayer(handles: string[]): Promise<ZamaDecryptResponse> {
  // Format handles for Zama API
  // - 'ciphertextHandles': array of hex handles
  // - 'extraData': required field, must be "0x00" for public decryption
  const requestBody = {
    ciphertextHandles: handles,
    extraData: "0x00",
  };

  console.log("[DecryptProxy] Calling Zama relayer with handles:", handles.map(h => h.slice(0, 20) + "..."));

  const response = await fetchWithTimeout(
    ZAMA_RELAYER_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    },
    REQUEST_TIMEOUT_MS,
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`Zama relayer error (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as ZamaDecryptResponse;

  if (data.error) {
    throw new Error(`Zama relayer error: ${data.error.message || JSON.stringify(data.error)}`);
  }

  return data;
}

async function decryptWithRetry(handles: string[], attempt = 0): Promise<ZamaDecryptResponse> {
  try {
    return await callZamaRelayer(handles);
  } catch (error) {
    console.log(`[DecryptProxy] Attempt ${attempt + 1} failed:`, error instanceof Error ? error.message : error);

    if (attempt < MAX_RETRIES && isRetryableError(error)) {
      const delay = Math.min(INITIAL_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
      console.log(`[DecryptProxy] Retrying in ${delay}ms...`);
      await sleep(delay);
      return decryptWithRetry(handles, attempt + 1);
    }

    throw error;
  }
}

// ============ Request Validation ============

function validateRequest(body: unknown): DecryptRequest {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid request body");
  }

  const data = body as Record<string, unknown>;

  if (!data.handles || !Array.isArray(data.handles)) {
    throw new Error("Missing or invalid 'handles' field - expected array of hex strings");
  }

  if (data.handles.length === 0) {
    throw new Error("Empty handles array");
  }

  if (data.handles.length > 10) {
    throw new Error("Too many handles - maximum 10 per request");
  }

  // Validate each handle is a hex string
  for (const handle of data.handles) {
    if (typeof handle !== "string") {
      throw new Error("Each handle must be a string");
    }
    if (!handle.startsWith("0x")) {
      throw new Error("Each handle must start with 0x");
    }
  }

  return {
    handles: data.handles as string[],
  };
}

// ============ API Handler ============

export async function POST(req: NextRequest) {
  console.log("[DecryptProxy] Received decrypt request");

  try {
    // Parse and validate request
    const body = await req.json();
    const { handles } = validateRequest(body);

    console.log("[DecryptProxy] Decrypting", handles.length, "handle(s)");

    // Call Zama relayer with retry logic
    const result = await decryptWithRetry(handles);

    console.log("[DecryptProxy] Decryption successful");

    // Transform response to match frontend expectations
    // The frontend expects clearValues to be keyed by the original handle
    const clearValues: Record<string, string> = {};

    // Handle new Zama response format: { response: [{ decrypted_value, signatures }] }
    if (result.response && Array.isArray(result.response)) {
      // Map each decrypted value to its corresponding handle
      for (let i = 0; i < handles.length && i < result.response.length; i++) {
        const decryptedHex = result.response[i].decrypted_value;
        // Convert hex string to decimal string
        // Remove leading zeros and convert to bigint then string
        const decimalValue = BigInt("0x" + decryptedHex).toString();
        clearValues[handles[i]] = decimalValue;
        console.log(`[DecryptProxy] Handle ${handles[i].slice(0, 20)}... = ${decimalValue}`);
      }
    } else if (result.clearValues) {
      // Legacy format support
      for (const [key, value] of Object.entries(result.clearValues)) {
        clearValues[key] = String(value);
      }
    }

    return NextResponse.json({
      success: true,
      clearValues,
      // Include signatures for verification if needed
      ...(result.response && { signatures: result.response.map(r => r.signatures) }),
    });
  } catch (error) {
    console.error("[DecryptProxy] Error:", error);

    const message = error instanceof Error ? error.message : "Unknown error";

    // Determine appropriate status code
    let status = 500;
    if (message.includes("Invalid") || message.includes("Missing")) {
      status = 400;
    }
    if (message.includes("timeout") || message.includes("504")) {
      status = 504;
    }

    return NextResponse.json({ success: false, error: message }, { status });
  }
}

// Health check
export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "decrypt-proxy",
    relayerUrl: ZAMA_RELAYER_URL,
    config: {
      maxRetries: MAX_RETRIES,
      initialDelayMs: INITIAL_DELAY_MS,
      maxDelayMs: MAX_DELAY_MS,
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
    },
  });
}
