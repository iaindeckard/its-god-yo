import { defineConfig } from "vitest/config";

// Unit tests only. The integration script (scripts/test-stop-cancel.ts) is NOT a
// *.test.ts and is intentionally excluded — it hits Stripe test mode + a live DB
// and is run by hand, never by `vitest run`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/__tests__/**/*.test.ts"],
  },
});
