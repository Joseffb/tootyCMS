import { describe, expect, it } from "vitest";
import {
  getViewCountSkipReason,
  getViewCountThrottleState,
  parseViewCount,
  VIEW_COUNT_WINDOW_MS,
} from "@/lib/view-count";

describe("view-count helpers", () => {
  it("parses positive integers and falls back to zero", () => {
    expect(parseViewCount("12")).toBe(12);
    expect(parseViewCount("invalid")).toBe(0);
    expect(parseViewCount(-5)).toBe(0);
  });

  it("skips obvious bot and prefetch traffic", () => {
    expect(
      getViewCountSkipReason(
        new Headers({ "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" }),
      ),
    ).toBe("bot");
    expect(
      getViewCountSkipReason(new Headers({ purpose: "prefetch" })),
    ).toBe("prefetch");
  });

  it("throttles repeated views for the same post within the guard window", () => {
    const first = getViewCountThrottleState({
      rawCookie: "",
      postId: "post-1",
      now: 1000,
    });
    expect(first.throttled).toBe(false);

    const second = getViewCountThrottleState({
      rawCookie: first.serialized,
      postId: "post-1",
      now: 1000 + VIEW_COUNT_WINDOW_MS - 1,
    });
    expect(second.throttled).toBe(true);

    const third = getViewCountThrottleState({
      rawCookie: first.serialized,
      postId: "post-1",
      now: 1000 + VIEW_COUNT_WINDOW_MS + 1,
    });
    expect(third.throttled).toBe(false);
  });
});
