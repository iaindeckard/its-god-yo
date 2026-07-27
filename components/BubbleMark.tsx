/**
 * BubbleMark — the locked "It's God, Yo!" speech-bubble mark. Geometry is the
 * verbatim locked brand spec (IGY-Brand-Identity-Mark-LOCKED-2026-07-27): a
 * rounded speech bubble with a tail at the bottom-left, holding the exclamation
 * point — a flattened horizontal halo RING (ellipse, not an arc) above a tilted
 * bar + a dot aligned to the bar's rotated position. Do NOT re-derive this from a
 * description; copy the path data from the locked spec exactly.
 *
 *   variant="primary" -> blue bubble, white mark (default)
 *   variant="light"   -> white bubble, blue mark (for use on solid-blue surfaces)
 */
export default function BubbleMark({
  variant = "primary",
  size = 72,
  className,
  title = "It's God, Yo! mark",
}: {
  variant?: "primary" | "light";
  size?: number;
  className?: string;
  title?: string;
}) {
  const bubble = variant === "light" ? "#FFFFFF" : "#378ADD";
  const mark = variant === "light" ? "#378ADD" : "#FFFFFF";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 72 72"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
      className={className}
    >
      <title>{title}</title>
      {/* speech bubble, tail bottom-left */}
      <path
        d="M14 10 H58 A8 8 0 0 1 66 18 V48 A8 8 0 0 1 58 56 H28 L14 66 V56 A8 8 0 0 1 6 48 V18 A8 8 0 0 1 14 10 Z"
        fill={bubble}
      />
      {/* flattened horizontal halo ring (ellipse, not an arc) above the bang */}
      <ellipse cx="36" cy="16" rx="10" ry="3.5" fill="none" stroke={mark} strokeWidth="2.4" opacity="0.95" />
      {/* tilted bar + dot aligned to the bar's rotated position = the "!" */}
      <rect x="32.85" y="23" width="6.3" height="20" rx="3.15" fill={mark} transform="rotate(-8 36 33)" />
      <circle cx="37.5" cy="48" r="3.78" fill={mark} />
    </svg>
  );
}
