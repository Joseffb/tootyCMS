import { describe, expect, it, vi } from "vitest";
import { signCanonicalPayload, verifyInboundSignature } from "@/lib/signing";

describe("signing service", () => {
  it("signs canonical payload with timestamp + hash", () => {
    const payload = JSON.stringify({ hello: "world" });
    const signed = signCanonicalPayload({
      canonicalPayloadJson: payload,
      secret: "test-secret",
      timestamp: "2026-02-25T00:00:00.000Z",
    });
    expect(signed.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(signed.signature).toMatch(/^[a-f0-9]{64}$/);
    expect(signed.timestamp).toBe("2026-02-25T00:00:00.000Z");
  });

  it("returns unsigned marker when secret is missing", () => {
    const signed = signCanonicalPayload({
      canonicalPayloadJson: JSON.stringify({ ok: true }),
      secret: "",
    });
    expect(signed.signature).toBe("unsigned");
  });

  it("does not enforce verification when policy is off", async () => {
    vi.stubEnv("TOOTY_SIGNATURE_POLICY", "off");
    const result = await verifyInboundSignature({
      context: "webcallback",
      headers: {},
      rawBody: "{}",
      secret: "",
    });
    expect(result.ok).toBe(true);
    vi.unstubAllEnvs();
  });

  it("enforces verification when policy is enforce", async () => {
    vi.stubEnv("TOOTY_SIGNATURE_POLICY", "enforce");
    const result = await verifyInboundSignature({
      context: "communications-callback",
      headers: {},
      rawBody: "{}",
      secret: "secret",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("signature_or_timestamp_missing");
    vi.unstubAllEnvs();
  });
});

