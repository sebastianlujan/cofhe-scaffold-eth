"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";

/**
 * EVVM Footer - Dark green matching navbar
 */
export const Footer = () => {
  return (
    <footer className="w-full bg-[#00221E] mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          {/* Left - Logo & Branding */}
          <div className="flex items-center gap-3">
            <div className="relative w-8 h-8 rounded-lg bg-[#00EE96]/15 p-1.5 flex items-center justify-center">
              <Image alt="EVVM" src="/evvm-logo.svg" width={18} height={18} className="object-contain" />
            </div>
            <div className="flex flex-col">
              <span className="font-semibold text-[#00EE96] text-sm">EVVM</span>
              <span className="text-xs text-white/50">Encrypted Virtual Virtual Machine</span>
            </div>
          </div>

          {/* Center - Links */}
          <div className="flex items-center gap-6 text-sm">
            <Link href="/" className="text-white/70 hover:text-white transition-colors font-medium">
              Home
            </Link>
            <Link href="/evvm-cafe" className="text-white/70 hover:text-white transition-colors font-medium">
              Cafe Demo
            </Link>
            <Link href="/debug" className="text-white/70 hover:text-white transition-colors font-medium">
              Debug
            </Link>
            <a
              href="https://github.com/evvm-org"
              target="_blank"
              rel="noopener noreferrer"
              className="text-white/70 hover:text-white transition-colors font-medium"
            >
              GitHub
            </a>
            <a
              href="https://evvm.info/docs"
              target="_blank"
              rel="noopener noreferrer"
              className="text-white/70 hover:text-white transition-colors font-medium"
            >
              Docs
            </a>
          </div>

          {/* Right - Network Status */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#00EE96]/15 border border-[#00EE96]/30">
            <div className="w-2 h-2 rounded-full bg-[#00EE96]" />
            <span className="text-sm font-medium text-[#00EE96]">Sepolia</span>
          </div>
        </div>

        {/* Bottom divider */}
        <div className="mt-6 pt-4 border-t border-white/10">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-white/40">
            <span>
              Powered by <span className="text-[#00EE96] font-medium">EVVM</span> using{" "}
              <span className="text-white/60">Fully Homomorphic Encryption</span>
            </span>
            <span>Testnet Demo</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
