"use client";

import React from "react";
import { LockClosedIcon, LockOpenIcon, ShieldCheckIcon } from "@heroicons/react/24/outline";
import { useDecryptValue } from "~~/app/hooks/useDecrypt";
import { useZamaFhevm } from "~~/app/hooks/useZamaFhevm";

interface EncryptedZoneProps {
  className?: string;
  children: React.ReactNode;
}

export const EncryptedZone = ({ className = "", children }: EncryptedZoneProps) => {
  return (
    <div className={`relative w-full ${className}`}>
      <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: "none" }}>
        <defs>
          <linearGradient id="borderGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" className="text-purple-400" style={{ stopColor: "currentColor" }} />
            <stop offset="100%" className="text-purple-600" style={{ stopColor: "currentColor" }} />
          </linearGradient>
        </defs>
        <rect
          x="1"
          y="1"
          width="calc(100% - 2px)"
          height="calc(100% - 2px)"
          fill="none"
          stroke="url(#borderGradient)"
          strokeWidth="2"
          rx="16"
          ry="16"
        />
      </svg>

      {/* Content */}
      <div className="relative flex flex-1 items-center justify-between p-2 w-full">
        {children}
        <div className="ml-4 flex items-center justify-center">
          <span className="inline-flex items-center justify-center w-8 h-10 rounded-md bg-gradient-to-br from-purple-400 to-purple-600 shadow-lg">
            <ShieldCheckIcon className="w-5 h-5 text-white" aria-hidden="true" />
          </span>
        </div>
      </div>
    </div>
  );
};

interface EncryptedValueProps {
  ctHash: bigint | null | undefined;
  label: string;
}

/**
 * EncryptedValue Component
 *
 * A reusable component for displaying and decrypting encrypted FHE values.
 * Uses the Zama FHEVM Relayer SDK for decryption.
 *
 * NOTE: This component uses PUBLIC decryption which works for values
 * that were made publicly decryptable via FHE.makePubliclyDecryptable().
 * For true privacy, contracts would need to use FHE.allow() instead.
 */
export const EncryptedValue = ({ label, ctHash }: EncryptedValueProps) => {
  const { isInitialized } = useZamaFhevm();
  const { value, state, error, onDecrypt } = useDecryptValue(ctHash);

  return (
    <div className="flex flex-row items-center justify-start p-1 pl-4 gap-2 flex-1 rounded-3xl bg-primary-content/5 min-h-12">
      <span className="text-xs font-semibold">{label}</span>

      {state === "no-data" && <span className="text-xs font-semibold flex-1 italic">No data</span>}

      {(state === "encrypted" || state === "idle") && ctHash && ctHash !== 0n && (
        <span className={`btn btn-md btn-cofhe flex-1 ${isInitialized ? "" : "btn-disabled"}`} onClick={onDecrypt}>
          <LockClosedIcon className="w-5 h-5" aria-hidden="true" />
          <span className="flex flex-1 items-center justify-center">
            <span>Encrypted</span>
          </span>
        </span>
      )}

      {state === "pending" && (
        <span className="btn btn-md btn-cofhe btn-disabled flex-1">
          <div className="loading-spinner loading-sm" />
          Decrypting
        </span>
      )}

      {state === "success" && (
        <div className="flex flex-1 px-4 items-center justify-center gap-2 h-10 bg-success/10 border-success border-2 border-solid rounded-full">
          <LockOpenIcon className="w-5 h-5 text-success" aria-hidden="true" />
          <div className="flex flex-1 items-center justify-center">
            <span className="font-mono">{value?.toString() ?? "0"}</span>
          </div>
        </div>
      )}

      {state === "error" && <span className="text-xs text-warning font-semibold flex-1 italic">{error}</span>}
    </div>
  );
};

// For backward compatibility
export const EncryptedValueCard = (props: EncryptedValueProps) => {
  return (
    <EncryptedZone>
      <EncryptedValue {...props} />
    </EncryptedZone>
  );
};
