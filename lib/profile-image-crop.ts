export const PROFILE_IMAGE_CROP_VIEWPORT = 240;
export const PROFILE_IMAGE_EXPORT_SIZE = 512;

export type ProfileCropBox = {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  zoom: number;
};

type CropInput = {
  naturalWidth: number;
  naturalHeight: number;
  viewportSize?: number;
  zoom?: number;
};

export function getProfileCropBox(input: CropInput): ProfileCropBox {
  const viewportSize = input.viewportSize || PROFILE_IMAGE_CROP_VIEWPORT;
  const naturalWidth = Math.max(1, Math.trunc(input.naturalWidth || 0));
  const naturalHeight = Math.max(1, Math.trunc(input.naturalHeight || 0));
  const zoom = Math.max(1, Number(input.zoom || 1));
  const baseScale = Math.max(viewportSize / naturalWidth, viewportSize / naturalHeight);
  const scale = baseScale * zoom;
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;

  return {
    width,
    height,
    offsetX: (viewportSize - width) / 2,
    offsetY: (viewportSize - height) / 2,
    zoom,
  };
}

export function clampProfileCropOffset(input: {
  viewportSize?: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}) {
  const viewportSize = input.viewportSize || PROFILE_IMAGE_CROP_VIEWPORT;
  const minOffsetX = Math.min(0, viewportSize - input.width);
  const minOffsetY = Math.min(0, viewportSize - input.height);

  return {
    offsetX: Math.min(0, Math.max(minOffsetX, input.offsetX)),
    offsetY: Math.min(0, Math.max(minOffsetY, input.offsetY)),
  };
}

export function createProfileCropSourceRect(input: {
  naturalWidth: number;
  naturalHeight: number;
  viewportSize?: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}) {
  const viewportSize = input.viewportSize || PROFILE_IMAGE_CROP_VIEWPORT;
  const scaleX = input.width / Math.max(1, input.naturalWidth);
  const scaleY = input.height / Math.max(1, input.naturalHeight);
  const scale = Math.max(scaleX, scaleY, 0.0001);
  const sourceX = Math.max(0, (-input.offsetX) / scale);
  const sourceY = Math.max(0, (-input.offsetY) / scale);
  const sourceWidth = Math.min(input.naturalWidth, viewportSize / scale);
  const sourceHeight = Math.min(input.naturalHeight, viewportSize / scale);

  return {
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
  };
}
