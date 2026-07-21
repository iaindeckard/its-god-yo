/**
 * BubbleMark — the locked "It's God, Yo!" speech-bubble mark. Geometry matches
 * the locked brand spec (see IGY-Landing-Page-Redesign-v12): a rounded speech
 * bubble with a tail at the bottom-left, holding the exclamation point — a thin
 * white halo arc above a tilted white bar + an offset white dot. The halo must
 * read clearly (stroke 3.4), not as a hairline.
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
      {/* thin white halo arc above the bang — clearly visible, not a hairline */}
      <path d="M24 17 Q35 7 46 17" stroke={mark} strokeWidth="3.4" fill="none" strokeLinecap="round" opacity="0.95" />
      {/* tilted bar + offset dot = the exclamation point */}
      <rect x="30" y="20" width="10" height="24" rx="5" fill={mark} transform="rotate(-8 35 32)" />
      <circle cx="36" cy="50" r="5.5" fill={mark} />
    </svg>
  );
}
