import { useRef } from "react";
import { getAddress } from "viem";
import { Address } from "viem";
import { useDisconnect } from "wagmi";
import {
  ArrowLeftOnRectangleIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  DocumentDuplicateIcon,
} from "@heroicons/react/24/outline";
import { BlockieAvatar, isENS } from "~~/components/scaffold-eth";
import { useCopyToClipboard, useOutsideClick } from "~~/hooks/scaffold-eth";

type AddressInfoDropdownProps = {
  address: Address;
  displayName: string;
  ensAvatar?: string;
};

export const AddressInfoDropdown = ({ address, ensAvatar, displayName }: AddressInfoDropdownProps) => {
  const { disconnect } = useDisconnect();
  const checkSumAddress = getAddress(address);

  const { copyToClipboard: copyAddressToClipboard, isCopiedToClipboard: isAddressCopiedToClipboard } =
    useCopyToClipboard();
  const dropdownRef = useRef<HTMLDetailsElement>(null);

  const closeDropdown = () => {
    dropdownRef.current?.removeAttribute("open");
  };

  useOutsideClick(dropdownRef, closeDropdown);

  return (
    <>
      <details ref={dropdownRef} className="dropdown dropdown-end leading-3">
        <summary className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 cursor-pointer transition-colors">
          <BlockieAvatar address={checkSumAddress} size={24} ensImage={ensAvatar} />
          <span className="text-white text-sm font-medium">
            {isENS(displayName) ? displayName : checkSumAddress?.slice(0, 6) + "..." + checkSumAddress?.slice(-4)}
          </span>
          <ChevronDownIcon className="h-4 w-4 text-white/60" />
        </summary>
        <ul className="dropdown-content menu z-50 p-2 mt-2 shadow-lg bg-white border border-gray-200 rounded-xl gap-1 min-w-[200px]">
          {/* Copy Address */}
          <li>
            <div
              className="h-8 btn-sm rounded-lg! flex gap-3 py-3 cursor-pointer text-gray-700 hover:bg-gray-100"
              onClick={() => copyAddressToClipboard(checkSumAddress)}
            >
              {isAddressCopiedToClipboard ? (
                <>
                  <CheckCircleIcon className="h-5 w-5 text-green-500" aria-hidden="true" />
                  <span className="whitespace-nowrap">Copied!</span>
                </>
              ) : (
                <>
                  <DocumentDuplicateIcon className="h-5 w-5" aria-hidden="true" />
                  <span className="whitespace-nowrap">Copy address</span>
                </>
              )}
            </div>
          </li>
          {/* Disconnect */}
          <li>
            <button
              className="h-8 btn-sm rounded-lg! flex gap-3 py-3 text-red-500 hover:bg-red-50"
              type="button"
              onClick={() => disconnect()}
            >
              <ArrowLeftOnRectangleIcon className="h-5 w-5" /> <span>Disconnect</span>
            </button>
          </li>
        </ul>
      </details>
    </>
  );
};
