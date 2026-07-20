/**
 * Wordmark — "It's God, Yo!" rendered as LIVE TEXT (never a flattened image),
 * so it stays crisp at any size and is selectable / accessible. The visual
 * treatment is pure CSS (see .brass-3d + .wordmark in globals.css):
 *   tone="brass" -> brass 3-D lettering, for dark surfaces (the hero)
 *   tone="flat"  -> flat brand-blue (#378ADD) lettering, for light surfaces
 * The exclamation point is emphasized to echo the bubble mark's "!".
 */
import type { ElementType } from "react";

export default function Wordmark({
  tone = "brass",
  as: Tag = "span",
  className = "",
}: {
  tone?: "brass" | "flat";
  as?: ElementType;
  className?: string;
}) {
  return (
    <Tag className={`wordmark ${tone === "brass" ? "brass-3d" : "wordmark-flat"} ${className}`.trim()}>
      It&rsquo;s God, Yo<span className="wordmark-bang">!</span>
    </Tag>
  );
}
