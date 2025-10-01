"use client";

import React from "react";

type SpinnerProps = {
  size?: number; // pixel size for width/height
};

export function Spinner({ size = 20 }: SpinnerProps) {
  const px = Math.max(8, size);
  const borderWidth = Math.max(2, Math.round(px / 10));
  return (
    <span
      role="status"
      aria-label="Loading"
      className="inline-block rounded-full border border-solid border-accent-primary border-t-transparent animate-spin"
      style={{ width: px, height: px, borderWidth }}
    />
  );
}

export default Spinner;
