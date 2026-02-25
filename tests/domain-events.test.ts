import { describe, expect, it } from "vitest";
import { normalizeDomainEvent, registerDomainEventName } from "@/lib/domain-events";

describe("domain event registry", () => {
  it("accepts core event names", () => {
    const normalized = normalizeDomainEvent({
      version: 1,
      name: "communication.sent",
      timestamp: new Date().toISOString(),
      payload: {},
    });
    expect(normalized).not.toBeNull();
  });

  it("accepts plugin namespaced event names", () => {
    const normalized = normalizeDomainEvent({
      version: 1,
      name: "plugin.example.event",
      timestamp: new Date().toISOString(),
      payload: {},
    });
    expect(normalized).not.toBeNull();
  });

  it("accepts explicitly registered custom names", () => {
    const ok = registerDomainEventName("plugin.custom.special");
    expect(ok).toBe(true);
    const normalized = normalizeDomainEvent({
      version: 1,
      name: "plugin.custom.special",
      timestamp: new Date().toISOString(),
      payload: {},
    });
    expect(normalized).not.toBeNull();
  });

  it("rejects unknown non-plugin names", () => {
    const normalized = normalizeDomainEvent({
      version: 1,
      name: "unregistered_event",
      timestamp: new Date().toISOString(),
      payload: {},
    });
    expect(normalized).toBeNull();
  });
});

