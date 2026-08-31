import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendSms } from "../sms";

/**
 * Locks the Twilio request shape of the shared sendSms so the extraction from
 * lib/dailySend is provably byte-identical: same endpoint, method, Basic auth,
 * content-type, and form fields (From/To/Body/StatusCallback), same return mapping.
 */
describe("sendSms — Twilio request shape (byte-identical to the pre-extraction call)", () => {
  const OLD_ENV = { ...process.env };
  beforeEach(() => {
    process.env.TWILIO_ACCOUNT_SID = "ACtest";
    process.env.TWILIO_AUTH_TOKEN = "tok";
    process.env.TWILIO_FROM_NUMBER = "+18005551212";
    process.env.TWILIO_STATUS_URL = "https://status.example/api/twilio/status";
    delete process.env.NEXT_PUBLIC_SITE_URL;
  });
  afterEach(() => {
    process.env = { ...OLD_ENV };
    vi.restoreAllMocks();
  });

  it("posts the exact URL, auth header, content-type, and form body; maps sid + segments", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ sid: "SM1", num_segments: "2" }) }));
    vi.stubGlobal("fetch", fetchMock);

    const r = await sendSms("+13165551234", "hello world");
    expect(r).toEqual({ sid: "SM1", segments: 2 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0] as unknown as [string, { method: string; headers: Record<string, string>; body: string }];
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages.json");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe("Basic " + Buffer.from("ACtest:tok").toString("base64"));
    expect(opts.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");

    const params = new URLSearchParams(opts.body);
    expect(params.get("From")).toBe("+18005551212");
    expect(params.get("To")).toBe("+13165551234");
    expect(params.get("Body")).toBe("hello world");
    expect(params.get("StatusCallback")).toBe("https://status.example/api/twilio/status");
  });

  it("omits StatusCallback when neither TWILIO_STATUS_URL nor NEXT_PUBLIC_SITE_URL is set", async () => {
    delete process.env.TWILIO_STATUS_URL;
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ sid: "SM2", num_segments: 1 }) }));
    vi.stubGlobal("fetch", fetchMock);
    await sendSms("+1", "x");
    const [, opts] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(new URLSearchParams(opts.body).has("StatusCallback")).toBe(false);
  });

  it("throws twilio_not_configured when credentials are missing", async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    await expect(sendSms("+1", "x")).rejects.toThrow("twilio_not_configured");
  });

  it("throws twilio_<status> on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ message: "bad" }) })));
    await expect(sendSms("+1", "x")).rejects.toThrow("twilio_400: bad");
  });
});
