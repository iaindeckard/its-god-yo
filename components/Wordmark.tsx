/**
 * Wordmark — "It's God, Yo" rendered as LIVE TEXT, with the bubble-and-bang icon
 * serving as the "!" (there is NO typed "!"). Per the locked brand spec, only
 * "God," ever takes the brass/gold treatment; "It's" and "Yo" stay white on dark
 * surfaces (tone="brass") or brand-blue on light surfaces (tone="flat").
 * Visual treatment is CSS — see the .wordmark rules in globals.css.
 */
import type { ElementType } from "react";
import BubbleMark from "./BubbleMark";

export default function Wordmark({
  tone = "brass",
  as: Tag = "span",
  className = "",
  showIcon = true,
}: {
  tone?: "brass" | "flat";
  as?: ElementType;
  className?: string;
  // The bubble-and-bang icon is the locked brand "!" and is shown by default
  // everywhere. Set false only where the mark is presented separately from the
  // wordmark (the onboarding lockup shows a single large bubble in the left
  // gutter instead of inside the wordmark).
  showIcon?: boolean;
}) {
  return (
    <Tag className={`wordmark wordmark-${tone} ${className}`.trim()}>
      <span className="w-its">It&rsquo;s</span>
      <span className="w-god">&nbsp;God,</span>
      <span className="w-yo">Yo<sup className="w-tm">&trade;</sup></span>
      {showIcon && <BubbleMark className="w-icon" title="It's God, Yo!" />}
    </Tag>
  );
}
