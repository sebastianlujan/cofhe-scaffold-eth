import React from "react";
import { Toast, ToastPosition, toast } from "react-hot-toast";
import { XMarkIcon } from "@heroicons/react/20/solid";
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/solid";

type NotificationProps = {
  content: React.ReactNode;
  status: "success" | "info" | "loading" | "error" | "warning";
  duration?: number;
  icon?: string;
  position?: ToastPosition;
};

type NotificationOptions = {
  duration?: number;
  icon?: string;
  position?: ToastPosition;
};

const DEFAULT_DURATION = 4000;
const DEFAULT_POSITION: ToastPosition = "top-center";

// Elegant, minimal status styling
const STATUS_STYLES = {
  success: {
    bg: "bg-emerald-50 border border-emerald-200",
    text: "text-emerald-800",
    icon: <CheckCircleIcon className="w-5 h-5 text-emerald-500" />,
  },
  error: {
    bg: "bg-rose-50 border border-rose-200",
    text: "text-rose-800",
    icon: <ExclamationCircleIcon className="w-5 h-5 text-rose-500" />,
  },
  warning: {
    bg: "bg-amber-50 border border-amber-200",
    text: "text-amber-800",
    icon: <ExclamationTriangleIcon className="w-5 h-5 text-amber-500" />,
  },
  info: {
    bg: "bg-sky-50 border border-sky-200",
    text: "text-sky-800",
    icon: <InformationCircleIcon className="w-5 h-5 text-sky-500" />,
  },
  loading: {
    bg: "bg-gray-50 border border-gray-200",
    text: "text-gray-700",
    icon: <span className="w-5 h-5 loading loading-spinner text-gray-500"></span>,
  },
};

/**
 * Elegant Notification Component
 */
const Notification = ({
  content,
  status,
  duration = DEFAULT_DURATION,
  icon,
  position = DEFAULT_POSITION,
}: NotificationProps) => {
  const style = STATUS_STYLES[status];

  return toast.custom(
    (t: Toast) => (
      <div
        className={`z-[9999] flex items-center gap-3 max-w-md rounded-lg shadow-sm px-4 py-3 transform-gpu transition-all duration-300 ease-out ${style.bg}
        ${t.visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2"}`}
      >
        {/* Icon */}
        <div className="flex-shrink-0">{icon ? icon : style.icon}</div>

        {/* Content */}
        <div className={`flex-1 text-sm font-medium ${style.text}`}>{content}</div>

        {/* Close button */}
        <button
          onClick={() => toast.dismiss(t.id)}
          className={`flex-shrink-0 p-1 rounded-full hover:bg-black/5 transition-colors ${style.text}`}
        >
          <XMarkIcon className="w-4 h-4 opacity-60" />
        </button>
      </div>
    ),
    {
      duration: status === "loading" ? Infinity : duration,
      position,
    },
  );
};

export const notification = {
  success: (content: React.ReactNode, options?: NotificationOptions) => {
    return Notification({ content, status: "success", duration: 5000, ...options });
  },
  info: (content: React.ReactNode, options?: NotificationOptions) => {
    return Notification({ content, status: "info", ...options });
  },
  warning: (content: React.ReactNode, options?: NotificationOptions) => {
    return Notification({ content, status: "warning", ...options });
  },
  error: (content: React.ReactNode, options?: NotificationOptions) => {
    return Notification({ content, status: "error", duration: 5000, ...options });
  },
  loading: (content: React.ReactNode, options?: NotificationOptions) => {
    return Notification({ content, status: "loading", ...options });
  },
  remove: (toastId: string) => {
    toast.remove(toastId);
  },
};
