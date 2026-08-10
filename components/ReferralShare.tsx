"use client";
import { useState } from "react";
import { trackConversion } from "@/lib/conversionAnalytics";

const url = "https://itsgodyo.com/?utm_source=customer_referral&utm_medium=share&utm_campaign=activation";
const text = `I thought you might like It’s God, Yo. It is a short, human-reviewed Scripture text made for teens. ${url}`;

export default function ReferralShare() {
  const [copied, setCopied] = useState(false);
  function tracked() { trackConversion("referral_shared", { channel: "activation" }); }
  async function copy() { await navigator.clipboard.writeText(url); tracked(); setCopied(true); }
  return <div style={{ marginTop: 22 }}>
    <p><strong>Know a family this could help?</strong></p>
    <div className="row">
      <a className="btn btn-ghost" href={`sms:?&body=${encodeURIComponent(text)}`} onClick={tracked}>Text it</a>
      <a className="btn btn-ghost" href={`mailto:?subject=${encodeURIComponent("A daily Scripture text for teens")}&body=${encodeURIComponent(text)}`} onClick={tracked}>Email it</a>
      <button className="btn btn-ghost" onClick={copy}>{copied ? "Copied" : "Copy link"}</button>
    </div>
  </div>;
}
