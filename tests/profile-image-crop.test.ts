import { describe, expect, it } from "vitest";

import {
  clampProfileCropOffset,
  createProfileCropSourceRect,
  getProfileCropBox,
  PROFILE_IMAGE_CROP_VIEWPORT,
} from "@/lib/profile-image-crop";

describe("profile image crop geometry", () => {
  it("builds a centered crop box that fully covers the viewport", () => {
    const crop = getProfileCropBox({
      naturalWidth: 1200,
      naturalHeight: 800,
    });

    expect(crop.width).toBeGreaterThanOrEqual(PROFILE_IMAGE_CROP_VIEWPORT);
    expect(crop.height).toBeGreaterThanOrEqual(PROFILE_IMAGE_CROP_VIEWPORT);
    expect(crop.offsetX).toBeLessThanOrEqual(0);
    expect(crop.offsetY).toBeLessThanOrEqual(0);
  });

  it("clamps drag offsets so the image always covers the crop viewport", () => {
    const clamped = clampProfileCropOffset({
      width: 320,
      height: 320,
      offsetX: 100,
      offsetY: -200,
    });

    expect(clamped.offsetX).toBe(0);
    expect(clamped.offsetY).toBe(-80);
  });

  it("maps viewport coordinates back to source-image crop coordinates", () => {
    const rect = createProfileCropSourceRect({
      naturalWidth: 1000,
      naturalHeight: 1000,
      width: 300,
      height: 300,
      offsetX: -30,
      offsetY: -45,
    });

    expect(rect.sourceX).toBeCloseTo(100, 3);
    expect(rect.sourceY).toBeCloseTo(150, 3);
    expect(rect.sourceWidth).toBeCloseTo(800, 3);
    expect(rect.sourceHeight).toBeCloseTo(800, 3);
  });
});
