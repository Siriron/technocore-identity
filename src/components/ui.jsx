import React from "react";

/**
 * Card: the base container for every section. White panel on a warm
 * paper background, soft shadow instead of a hard border, generous
 * radius. Reads as a physical card, not a wireframe box.
 */
export function Card({ eyebrow, title, children, className = "" }) {
  return (
    <section
      className={`bg-panel rounded-card shadow-soft border border-hairline animate-fade-up ${className}`}
    >
      {(eyebrow || title) && (
        <header className="px-5 pt-6 pb-1.5 md:px-6 md:pt-7">
          {eyebrow && (
            <span className="block text-[11px] uppercase tracking-[0.14em] text-stone-light font-sans font-medium mb-1">
              {eyebrow}
            </span>
          )}
          {title && (
            <h2 className="font-serif text-[19px] md:text-[21px] text-ink leading-snug">
              {title}
            </h2>
          )}
        </header>
      )}
      <div className="px-5 py-5 md:px-6 md:py-6">{children}</div>
    </section>
  );
}

/**
 * Button: iOS-scaled touch target by default (52px tall, full-width
 * on mobile), shrinks slightly and goes auto-width at the md breakpoint
 * for desktop, where a 52px full-width button would look oversized
 * next to a mouse pointer.
 */
export function Button({
  children,
  onClick,
  variant = "primary",
  disabled,
  type = "button",
  fullWidth = true,
}) {
  const base =
    "h-[52px] md:h-[44px] px-6 rounded-control text-[16px] md:text-[14px] font-sans font-medium " +
    "transition-all duration-200 ease-fluid active:scale-[0.97] " +
    "disabled:opacity-40 disabled:active:scale-100 disabled:cursor-not-allowed " +
    (fullWidth ? "w-full md:w-auto" : "");
  const variants = {
    primary: "bg-verified text-white shadow-soft hover:bg-verified-dark",
    secondary:
      "bg-transparent text-ink border border-hairline-strong hover:bg-parchment",
    danger:
      "bg-transparent text-seal-dark border border-seal/30 hover:bg-seal-light",
    seal: "bg-seal text-white shadow-soft hover:bg-seal-dark",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${variants[variant]}`}
    >
      {children}
    </button>
  );
}

/**
 * Field: label + input, sized for thumbs. 52px tall on mobile so it
 * matches the button height and creates a consistent rhythm down the
 * whole form.
 */
export function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="block text-[13px] font-sans font-medium text-stone mb-1.5">
        {label}
      </span>
      {children}
      {hint && <span className="block text-[12px] text-stone-light mt-1.5">{hint}</span>}
    </label>
  );
}

const inputBase =
  "w-full h-[52px] md:h-[44px] px-4 rounded-control border border-hairline-strong " +
  "bg-paper text-[16px] md:text-[14px] text-ink placeholder:text-stone-light " +
  "focus:outline-none focus:border-verified focus:ring-2 focus:ring-verified/15 " +
  "transition-all duration-150";

export function TextInput(props) {
  return <input {...props} className={`${inputBase} ${props.className || ""}`} />;
}

export function TextArea(props) {
  return (
    <textarea
      {...props}
      className={`${inputBase.replace("h-[52px] md:h-[44px]", "min-h-[104px] py-3")} resize-none ${
        props.className || ""
      }`}
    />
  );
}

/**
 * StatusMessage: inline feedback. Color and a small dot instead of an
 * icon font, so this file has zero external icon dependencies.
 */
export function StatusMessage({ tone = "neutral", children }) {
  const tones = {
    neutral: { text: "text-stone", dot: "bg-stone-light" },
    good: { text: "text-verified-dark", dot: "bg-verified" },
    warn: { text: "text-amber", dot: "bg-amber" },
    bad: { text: "text-seal-dark", dot: "bg-seal" },
  };
  const t = tones[tone];
  return (
    <p className={`flex items-start gap-2 text-[13px] leading-relaxed ${t.text} animate-fade-in`}>
      <span className={`mt-[6px] h-[6px] w-[6px] rounded-full shrink-0 ${t.dot}`} />
      <span>{children}</span>
    </p>
  );
}

/**
 * Toggle: iOS-style switch, for the "keep me signed in" preference.
 */
export function Toggle({ checked, onChange, label }) {
  return (
    <label className="flex items-center justify-between gap-3 cursor-pointer py-1">
      <span className="text-[14px] text-ink">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200 ease-fluid ${
          checked ? "bg-verified-muted" : "bg-hairline-strong"
        }`}
      >
        <span
          className={`absolute top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-soft transition-transform duration-200 ease-fluid ${
            checked ? "translate-x-[22px]" : "translate-x-[2px]"
          }`}
        />
      </button>
    </label>
  );
}
