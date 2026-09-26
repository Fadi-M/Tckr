/**
 * The app's small icon set — one 16×16 grid, one 1.6 stroke, `currentColor`, so every
 * icon inherits its context's colour and they all read as one family. Replaces the
 * Unicode glyphs (◷ ◴ ⚠ ⌕ ← ☀ ☾) the banners, search field, back pill and theme toggle
 * used to borrow, which rendered at font-dependent sizes and weights. Always decorative
 * (`aria-hidden`): the adjacent text carries the meaning.
 */
import type { ReactNode } from 'react';

interface IconProps {
  readonly size?: number;
  readonly className?: string;
}

function Icon({ size = 16, className = '', children }: IconProps & { readonly children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`flex-none ${className}`}
    >
      {children}
    </svg>
  );
}

/** Time: market hours, delayed data. */
export function ClockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M8 4.6V8l2.3 1.5" />
    </Icon>
  );
}

/** A retry in progress. */
export function RetryIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M13.2 8a5.2 5.2 0 1 1-1.6-3.75" />
      <path d="M13.3 2.6v2.9h-2.9" />
    </Icon>
  );
}

/** Something failed and needs the user. */
export function AlertIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 2.2 14.3 13.3H1.7Z" />
      <path d="M8 6.4v3.1" />
      <path d="M8 11.6h.01" />
    </Icon>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="7" cy="7" r="4.6" />
      <path d="m10.5 10.5 3.3 3.3" />
    </Icon>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M13 8H3.4" />
      <path d="M7.2 4 3.2 8l4 4" />
    </Icon>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="8" r="2.9" />
      <path d="M8 1.6v1.3M8 13.1v1.3M1.6 8h1.3M13.1 8h1.3M3.5 3.5l.9.9M11.6 11.6l.9.9M3.5 12.5l.9-.9M11.6 4.4l.9-.9" />
    </Icon>
  );
}

export function MoonIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M13.4 9.6A5.6 5.6 0 0 1 6.4 2.6a5.6 5.6 0 1 0 7 7Z" />
    </Icon>
  );
}

/** Something succeeded or recovered. */
export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="8" r="6.2" />
      <path d="m5.3 8.2 1.9 1.9 3.6-3.8" />
    </Icon>
  );
}
