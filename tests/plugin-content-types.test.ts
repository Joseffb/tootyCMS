import { describe, expect, it } from "vitest";
import { createKernel } from "@/lib/kernel";

describe("plugin content type registry", () => {
  it("stores plugin content types by plugin id", () => {
    const kernel = createKernel();
    kernel.registerPluginContentType("tooty-carousels", {
      key: "carousel-slide",
      label: "Carousel Slide",
      description: "Carousel slide entries",
      showInMenu: false,
      parentKey: "carousel",
      parentMetaKey: "carousel_id",
      embedHandleMetaKey: "carousel_key",
      workflowStates: ["draft", "published", "archived"],
      mediaFieldKeys: ["image", "media_id"],
    });

    expect(kernel.getPluginContentTypes("tooty-carousels")).toEqual([
      {
        key: "carousel-slide",
        label: "Carousel Slide",
        description: "Carousel slide entries",
        showInMenu: false,
        parentKey: "carousel",
        parentMetaKey: "carousel_id",
        embedHandleMetaKey: "carousel_key",
        workflowStates: ["draft", "published", "archived"],
        mediaFieldKeys: ["image", "media_id"],
      },
    ]);
  });
});
