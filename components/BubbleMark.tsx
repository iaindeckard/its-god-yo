/**
 * BubbleMark — the locked "It's God, Yo!" speech-bubble mark.
 * Geometry is the exact locked path data (do NOT re-guess it): a speech bubble
 * with a tail at the bottom-left, holding a tilted (-8deg) exclamation point +
 * halo arc that doubles as the "!" in "Yo".
 *
 *   variant="primary" -> blue bubble, white mark (default, use on light surfaces)
 *   variant="light"   -> white bubble, blue mark (for dark surfaces)
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
      <path
        d="M4 16 C4 8.268 10.268 2 18 2 L54 2 C61.732 2 68 8.268 68 16 L68 42 C68 49.732 61.732 56 54 56 L26 56 L10 68 L13 54 L18 54 C10.268 54 4 47.732 4 40 Z"
        fill={bubble}
      />
      <g transform="translate(36 31) rotate(-8)">
        <rect x="-3.2" y="-15" width="6.4" height="19" rx="3.2" fill={mark} />
        <circle cx="1.1" cy="11.5" r="4.2" fill={mark} />
        <ellipse cx="-0.5" cy="-21" rx="8.5" ry="2.6" fill="none" stroke={mark} strokeWidth="2.2" opacity="0.85" />
      </g>
    </svg>
  );
}
