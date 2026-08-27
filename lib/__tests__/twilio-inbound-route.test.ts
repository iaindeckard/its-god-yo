import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const processInboundReply = vi.fn();

vi.mock("../twilio", () => ({
  verifyTwilioSignature: () => true,
}));

vi.mock("../twilioInbound", () => ({
  processInboundReply,
}));

describe("Twilio inbound webhook", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.TWILIO_AUTH_TOKEN = "test-token";
    processInboundReply.mockReset();
  });

  afterEach(() => {
    delete process.env.TWILIO_AUTH_TOKEN;
  });

  async function post() {
    const { POST } = await import("../../app/api/twilio/inbound/route");
    return POST(new Request("https://example.test/api/twilio/inbound", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": "valid-for-mock",
      },
      body: new URLSearchParams({ From: "+13165550123", Body: "STOP" }),
    }));
  }

  it("returns 500 so Twilio retries when cancellation fails", async () => {
    processInboundReply.mockRejectedValueOnce(new Error("stripe unavailable"));

    const response = await post();

    expect(response.status).toBe(500);
    expect(await response.text()).toContain("temporary inbound processing failure");
  });

  it("acknowledges a completed STOP with TwiML", async () => {
    processInboundReply.mockResolvedValueOnce({
      action: "opted_out",
      reply: "Billing canceled.",
    });

    const response = await post();

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Billing canceled.");
  });
});
