import { describe, expect, it } from "vitest";
import { normalizeDomainEvent } from "@/lib/domain-events";

describe("normalizeDomainEvent", () => {
  it("accepts valid page_view payload", () => {
    const result = normalizeDomainEvent({
      version: 1,
      name: "page_view",
      timestamp: "2026-01-01T00:00:00.000Z",
      domain: "example.com",
      path: "/docs",
      actorType: "anonymous",
      payload: { foo: "bar" },
    });

    expect(result).not.toBeNull();
    expect(result?.name).toBe("page_view");
    expect(result?.version).toBe(1);
    expect(result?.payload).toEqual({ foo: "bar" });
  });

  it("rejects unknown event names", () => {
    const result = normalizeDomainEvent({
      version: 1,
      name: "totally_unknown_event",
      payload: {},
    });
    expect(result).toBeNull();
  });

  it("rejects unknown schema versions", () => {
    const result = normalizeDomainEvent({
      version: 2,
      name: "page_view",
      payload: {},
    });
    expect(result).toBeNull();
  });
});
