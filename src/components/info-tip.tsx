"use client";

import { useState } from "react";

export function InfoTip({ text, className = "" }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className={["relative inline-flex", className].join(" ")}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      tabIndex={0}
      aria-label={text}
      role="button"
    >
      <span
        className="ml-2 inline-flex items-center justify-center w-4 h-4 rounded-full border border-border-subtle text-xs text-text-secondary select-none"
      >
        i
      </span>
      {open && (
        <div
          className="absolute z-20 w-64 p-2 rounded-lg border border-border-subtle bg-bg-primary text-xs text-text-secondary shadow-xl"
          style={{ left: "100%", marginLeft: 8, bottom: "calc(100% + 8px)" }}
        >
          {text}
        </div>
      )}
    </span>
  );
}
