import { describe, expect, it } from "vitest";
import {
  assertSetupLifecycleTransition,
  canSetupLifecycleTransition,
  resolveSetupLifecycleState,
} from "@/lib/setup-lifecycle";

describe("setup lifecycle state resolution", () => {
  it("prefers valid stored lifecycle state", () => {
    expect(
      resolveSetupLifecycleState({
        storedState: "configured",
        setupCompleted: true,
        hasUsers: true,
        hasSites: true,
      }),
    ).toBe("configured");
  });

  it("returns ready when setupCompleted is true", () => {
    expect(resolveSetupLifecycleState({ setupCompleted: true })).toBe("ready");
  });

  it("returns ready for legacy installs with users and sites", () => {
    expect(resolveSetupLifecycleState({ hasUsers: true, hasSites: true })).toBe("ready");
  });

  it("returns migrated for partial legacy bootstrap", () => {
    expect(resolveSetupLifecycleState({ hasUsers: true, hasSites: false })).toBe("migrated");
    expect(resolveSetupLifecycleState({ hasUsers: false, hasSites: true })).toBe("migrated");
  });

  it("defaults to not_configured for empty installs", () => {
    expect(resolveSetupLifecycleState({})).toBe("not_configured");
  });

  it("allows only forward adjacent lifecycle transitions", () => {
    expect(canSetupLifecycleTransition("not_configured", "configured")).toBe(true);
    expect(canSetupLifecycleTransition("configured", "migrated")).toBe(true);
    expect(canSetupLifecycleTransition("migrated", "ready")).toBe(true);

    expect(canSetupLifecycleTransition("not_configured", "migrated")).toBe(false);
    expect(canSetupLifecycleTransition("configured", "ready")).toBe(false);
    expect(canSetupLifecycleTransition("migrated", "configured")).toBe(false);
    expect(canSetupLifecycleTransition("ready", "migrated")).toBe(false);
  });

  it("throws on illegal lifecycle transitions", () => {
    expect(() => assertSetupLifecycleTransition("not_configured", "migrated")).toThrow(
      /Invalid setup lifecycle transition/,
    );
    expect(() => assertSetupLifecycleTransition("ready", "configured")).toThrow(
      /Invalid setup lifecycle transition/,
    );
  });
});
