"use client";

import React, { useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bars3Icon } from "@heroicons/react/24/outline";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-eth";
import { useOutsideClick } from "~~/hooks/scaffold-eth";

type HeaderMenuLink = {
  label: string;
  href: string;
};

export const menuLinks: HeaderMenuLink[] = [
  { label: "Home", href: "/" },
  { label: "Gasless Cafe", href: "/evvm-cafe-gasless" },
  { label: "Debug", href: "/debug" },
];

export const HeaderMenuLinks = () => {
  const pathname = usePathname();

  return (
    <>
      {menuLinks.map(({ label, href }) => {
        const isActive = pathname === href;
        return (
          <li key={href}>
            <Link
              href={href}
              className={`
                px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200
                ${isActive ? "bg-[#00EE96]/20 text-[#00EE96]" : "text-white/80 hover:text-white hover:bg-white/10"}
              `}
            >
              {label}
            </Link>
          </li>
        );
      })}
    </>
  );
};

/**
 * EVVM Header - Dark green navbar with white text
 */
export const Header = () => {
  const burgerMenuRef = useRef<HTMLDetailsElement>(null);
  useOutsideClick(burgerMenuRef, () => {
    burgerMenuRef?.current?.removeAttribute("open");
  });

  return (
    <header className="sticky top-0 z-50 w-full bg-[#00221E] shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16">
          {/* Left - Logo and Nav */}
          <div className="flex items-center gap-8">
            {/* Mobile menu */}
            <details className="dropdown lg:hidden" ref={burgerMenuRef}>
              <summary className="btn btn-ghost p-2 text-white/80 hover:text-white hover:bg-white/10">
                <Bars3Icon className="h-6 w-6" />
              </summary>
              <ul
                className="menu menu-compact dropdown-content mt-3 p-3 bg-[#00221E] border border-[#003D35] rounded-xl w-56 shadow-xl space-y-1"
                onClick={() => burgerMenuRef?.current?.removeAttribute("open")}
              >
                <HeaderMenuLinks />
              </ul>
            </details>

            {/* Logo */}
            <Link href="/" className="flex items-center gap-3 group">
              <div className="relative w-10 h-10 rounded-lg bg-[#00EE96]/15 p-2 flex items-center justify-center group-hover:bg-[#00EE96]/25 transition-colors">
                <Image alt="EVVM" src="/evvm-logo.svg" width={24} height={24} className="object-contain" />
              </div>
              <div className="hidden sm:flex flex-col">
                <span className="font-bold text-lg text-[#00EE96] leading-tight">EVVM</span>
                <span className="text-xs text-white/60">Confidential Payments</span>
              </div>
            </Link>

            {/* Desktop Nav */}
            <nav className="hidden lg:block">
              <ul className="flex items-center gap-1">
                <HeaderMenuLinks />
              </ul>
            </nav>
          </div>

          {/* Right - Connect Button */}
          <div className="flex items-center">
            <RainbowKitCustomConnectButton />
          </div>
        </div>
      </div>
    </header>
  );
};
