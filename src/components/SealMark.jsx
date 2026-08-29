import React from "react";

/**
 * The app's signature mark: a wax seal with a key motif. Used in the
 * header, next to anything cryptographically signed, and as a loading/
 * success indicator. Reusing one real SVG (not a screenshot, not an
 * emoji) keeps it crisp at every size and keeps the "this was signed"
 * signal consistent everywhere it appears.
 */
export function SealMark({ size = 40, animate = false, className = "" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="Technocore seal"
      className={`${animate ? "animate-seal-stamp" : ""} ${className}`}
    >
      <circle cx="32" cy="32" r="30" fill="#B8433A" />
      <g transform="translate(32 32)">
        <circle cx="-5" cy="0" r="9" fill="none" stroke="#FAF9F6" strokeWidth="5.5" />
        <rect x="1.5" y="-2.5" width="15" height="5" fill="#FAF9F6" />
        <rect x="11" y="2.5" width="5" height="6" fill="#FAF9F6" />
      </g>
    </svg>
  );
}
