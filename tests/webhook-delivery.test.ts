import { describe, expect, it } from "vitest";
import { toWebhookPayload } from "@/lib/webhook-delivery";

describe("webhook delivery payload", () => {
  it("includes required envelope fields", () => {
    const payload = toWebhookPayload({
      id: "evt_1",
      version: 1,
      name: "communication.sent",
      timestamp: "2026-02-25T00:00:00.000Z",
      siteId: "site_1",
      payload: { messageId: "m1" },
    });

    expect(payload.event_id).toBe("evt_1");
    expect(payload.timestamp).toBe("2026-02-25T00:00:00.000Z");
    expect(payload.site_id).toBe("site_1");
    expect(payload.event_name).toBe("communication.sent");
  });
});

