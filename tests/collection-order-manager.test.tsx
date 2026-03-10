// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import CollectionOrderManager from "@/components/plugins/collection-order-manager";

describe("CollectionOrderManager", () => {
  it("supports moving items with explicit controls and persists the new order", async () => {
    const saveOrderAction = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(
      <CollectionOrderManager
        siteId="site-1"
        title="Slide Order"
        items={[
          { id: "slide-one", title: "Slide One", sortOrder: 0, editHref: "/edit/one" },
          { id: "slide-two", title: "Slide Two", sortOrder: 1, editHref: "/edit/two" },
        ]}
        extraFormData={{ setId: "set-1" }}
        saveOrderAction={saveOrderAction}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Move Slide One down" }));

    await waitFor(() => {
      expect(saveOrderAction).toHaveBeenCalledTimes(1);
    });

    const formData = saveOrderAction.mock.calls[0]?.[0] as FormData;
    expect(formData.get("siteId")).toBe("site-1");
    expect(formData.get("setId")).toBe("set-1");
    expect(formData.get("order")).toBe(
      JSON.stringify([
        { id: "slide-two", sortOrder: 0 },
        { id: "slide-one", sortOrder: 1 },
      ]),
    );

    const orderedLinks = screen.getAllByRole("link");
    expect(orderedLinks[0]).toHaveTextContent("Slide Two");
    expect(orderedLinks[1]).toHaveTextContent("Slide One");
  });
});
