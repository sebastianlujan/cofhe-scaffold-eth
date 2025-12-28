"use client";

import { useEffect, useState } from "react";
import { RainbowKitProvider, darkTheme, lightTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppProgressBar as ProgressBar } from "next-nprogress-bar";
import { useTheme } from "next-themes";
import { Toaster } from "react-hot-toast";
import { WagmiProvider, useAccount, useDisconnect } from "wagmi";
import { ZamaFhevmProvider } from "~~/app/hooks/useZamaFhevm";
import { Footer } from "~~/components/Footer";
import { Header } from "~~/components/Header";
import { BlockieAvatar } from "~~/components/scaffold-eth";
import { useInitializeNativeCurrencyPrice } from "~~/hooks/scaffold-eth";
import { wagmiConfig } from "~~/services/web3/wagmiConfig";
import { clearWalletCache } from "~~/utils/evvm/secureCache";

const CHAIN_ID = 11155111; // Sepolia

/**
 * Auto-disconnect wallet when browser/tab is closed
 * Also clears EVVM cache for the wallet
 */
const AutoDisconnect = () => {
  const { disconnect } = useDisconnect();
  const { isConnected, address } = useAccount();

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (isConnected) {
        // Clear EVVM secure cache for this wallet
        if (address) {
          clearWalletCache(CHAIN_ID, address);
        }
        // Disconnect wallet
        disconnect();
        // Clear wagmi connection state from localStorage
        localStorage.removeItem("wagmi.store");
        localStorage.removeItem("wagmi.connected");
        localStorage.removeItem("wagmi.wallet");
        localStorage.removeItem("wagmi.recentConnectorId");
        // Clear RainbowKit state
        localStorage.removeItem("rk-recent");
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [disconnect, isConnected, address]);

  return null;
};

const ScaffoldEthApp = ({ children }: { children: React.ReactNode }) => {
  useInitializeNativeCurrencyPrice();

  return (
    <>
      <AutoDisconnect />
      <div className={`flex flex-col min-h-screen`}>
        <Header />
        <main className="relative flex flex-col flex-1">{children}</main>
        <Footer />
      </div>
      <Toaster containerStyle={{ zIndex: 9999 }} />
    </>
  );
};

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

export const ScaffoldEthAppWithProviders = ({ children }: { children: React.ReactNode }) => {
  const { resolvedTheme } = useTheme();
  const isDarkMode = resolvedTheme === "dark";
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ProgressBar height="3px" color="#2299dd" />
        <RainbowKitProvider
          avatar={BlockieAvatar}
          theme={mounted ? (isDarkMode ? darkTheme() : lightTheme()) : lightTheme()}
        >
          <ZamaFhevmProvider>
            <ScaffoldEthApp>{children}</ScaffoldEthApp>
          </ZamaFhevmProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
};
