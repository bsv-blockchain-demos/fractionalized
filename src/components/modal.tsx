"use client";

import React from "react";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
}

export function Modal({ isOpen, onClose, title, children, className }: ModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />

      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        className={[
          "relative z-10 w-full max-w-md mx-4 rounded-xl shadow-xl",
          "bg-white dark:bg-bg-primary",
          className || "",
        ].join(" ")}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
          <h3 className="text-lg font-semibold text-text-primary">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-2 rounded hover:bg-bg-secondary text-text-secondary hover:text-text-primary"
          >
            ✕
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
