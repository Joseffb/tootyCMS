import crypto from "crypto";

export type MediaVariantSpec = {
  suffix: "size1" | "size2" | "size3";
  width: number;
};

export type GeneratedMediaVariant = {
  suffix: "original" | MediaVariantSpec["suffix"];
  buffer: Buffer;
  width: number | null;
  mimeType: string;
  extension: string;
};

export const MEDIA_VARIANT_SPECS: MediaVariantSpec[] = [
  { suffix: "size1", width: 480 },
  { suffix: "size2", width: 960 },
  { suffix: "size3", width: 1600 },
];

function normalizeExtensionFromMime(mimeType: string) {
  const raw = mimeType.split("/")[1]?.toLowerCase() || "bin";
  if (raw === "jpeg") return "jpg";
  return raw;
}

function normalizeMimeType(input: string) {
  if (input === "image/jpg") return "image/jpeg";
  if (input === "image/pjpeg") return "image/jpeg";
  return input;
}

export async function buildMediaVariants(file: File) {
  const sourceBuffer = Buffer.from(await file.arrayBuffer());
  const mimeType = normalizeMimeType(file.type || "application/octet-stream");
  const extension = normalizeExtensionFromMime(mimeType);
  const hash = crypto.createHash("sha256").update(sourceBuffer).digest("hex").slice(0, 20);

  let resized: GeneratedMediaVariant[] = [];
  try {
    const sharpMod = await import("sharp");
    const sharp = sharpMod.default;
    const fit = mimeType === "image/png" ? "inside" : "cover";

    resized = await Promise.all(
      MEDIA_VARIANT_SPECS.map(async (spec) => {
        let pipeline = sharp(sourceBuffer).rotate().resize({
          width: spec.width,
          withoutEnlargement: true,
          fit,
        });

        if (mimeType === "image/png") {
          pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true });
        } else {
          pipeline = pipeline.jpeg({ quality: 82, mozjpeg: true });
        }

        const buffer = await pipeline.toBuffer();
        return {
          suffix: spec.suffix,
          width: spec.width,
          buffer,
          mimeType,
          extension,
        } as GeneratedMediaVariant;
      }),
    );
  } catch {
    resized = [];
  }

  const variants: GeneratedMediaVariant[] = [
    {
      suffix: "original",
      buffer: sourceBuffer,
      width: null,
      mimeType,
      extension,
    },
    ...resized,
  ];

  return { hash, variants, mimeType, extension };
}
