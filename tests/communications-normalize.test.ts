import { describe, expect, it } from "vitest";
import { normalizeBody, normalizeChannel, normalizeTo } from "@/lib/communications";

describe("communications normalization", () => {
  it("accepts supported channels", () => {
    expect(normalizeChannel("email")).toBe("email");
    expect(normalizeChannel("sms")).toBe("sms");
    expect(normalizeChannel("mms")).toBe("mms");
    expect(normalizeChannel("com-x")).toBe("com-x");
  });

  it("rejects unsupported channels", () => {
    expect(() => normalizeChannel("fax")).toThrow("Unsupported communication channel");
  });

  it("requires recipient and body", () => {
    expect(() => normalizeTo("")).toThrow("recipient is required");
    expect(() => normalizeBody("")).toThrow("body is required");
    expect(normalizeTo("alice@example.com")).toBe("alice@example.com");
    expect(normalizeBody("hello")).toBe("hello");
  });
});
