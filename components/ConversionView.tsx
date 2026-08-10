"use client";

import { useEffect } from "react";
import { trackConversion, type ConversionEventName } from "@/lib/conversionAnalytics";

export default function ConversionView({ event, properties }: { event: ConversionEventName; properties?: Record<string, string | number | boolean | null> }) {
  // A view impression is intentionally emitted once for this mounted surface.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { trackConversion(event, properties); }, []); // view impression: once per mount
  return null;
}
