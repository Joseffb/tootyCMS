import { describe, expect, it } from "vitest";
import { createKernel } from "@/lib/kernel";

describe("plugin content type registry", () => {
  it("stores plugin content types by plugin id", () => {
    const kernel = createKernel();
    kernel.registerPluginContentType("tooty-carousels", {
      key: "carousel",
      label: "Carousel",
      description: "Carousel entries",
      showInMenu: false,
    });

    expect(kernel.getPluginContentTypes("tooty-carousels")).toEqual([
      {
        key: "carousel",
        label: "Carousel",
        description: "Carousel entries",
        showInMenu: false,
      },
    ]);
  });
});
