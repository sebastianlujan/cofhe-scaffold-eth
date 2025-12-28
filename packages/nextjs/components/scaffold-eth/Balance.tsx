"use client";

import { Address, formatEther } from "viem";
import { useDisplayUsdMode } from "~~/hooks/scaffold-eth/useDisplayUsdMode";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { useWatchBalance } from "~~/hooks/scaffold-eth/useWatchBalance";
import { useGlobalState } from "~~/services/store/store";

type BalanceProps = {
  address?: Address;
  className?: string;
  usdMode?: boolean;
};

/**
 * Display (ETH & USD) balance of an ETH address.
 */
export const Balance = ({ address, className = "", usdMode }: BalanceProps) => {
  const { targetNetwork } = useTargetNetwork();
  const nativeCurrencyPrice = useGlobalState(state => state.nativeCurrency.price);
  const isNativeCurrencyPriceFetching = useGlobalState(state => state.nativeCurrency.isFetching);

  const {
    data: balance,
    isError,
    isLoading,
  } = useWatchBalance({
    address,
  });

  const { displayUsdMode, toggleDisplayUsdMode } = useDisplayUsdMode({ defaultUsdMode: usdMode });

  if (!address || isLoading || balance === null || (isNativeCurrencyPriceFetching && nativeCurrencyPrice === 0)) {
    return (
      <div className="animate-pulse flex space-x-4">
        <div className="rounded-md bg-white/30 h-5 w-16"></div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className={`text-sm ${className}`}>
        <span className="text-red-400">Error</span>
      </div>
    );
  }

  const formattedBalance = balance ? Number(formatEther(balance.value)) : 0;

  return (
    <button
      className={`flex items-center gap-1 text-sm hover:opacity-80 transition-opacity ${className}`}
      onClick={toggleDisplayUsdMode}
      type="button"
    >
      {displayUsdMode ? (
        <>
          <span className="font-medium">$</span>
          <span className="font-medium">{(formattedBalance * nativeCurrencyPrice).toFixed(2)}</span>
        </>
      ) : (
        <>
          <span className="font-medium">{formattedBalance.toFixed(4)}</span>
          <span className="font-medium">{targetNetwork.nativeCurrency.symbol}</span>
        </>
      )}
    </button>
  );
};
