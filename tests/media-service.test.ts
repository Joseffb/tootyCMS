import { describe, expect, it } from "vitest";
import {
  buildS3ObjectUrl,
  normalizeMediaUploadMode,
  resolveMediaUploadCandidates,
  resolveS3ObjectAcl,
} from "@/lib/media-service";

describe("media service", () => {
  it("normalizes supported media provider modes", () => {
    expect(normalizeMediaUploadMode("blob")).toBe("blob");
    expect(normalizeMediaUploadMode("s3")).toBe("s3");
    expect(normalizeMediaUploadMode("dbblob")).toBe("dbblob");
  });

  it("falls back invalid provider modes to auto", () => {
    expect(normalizeMediaUploadMode("invalid")).toBe("auto");
    expect(normalizeMediaUploadMode("")).toBe("auto");
  });

  it("resolves deterministic provider candidates", () => {
    expect(resolveMediaUploadCandidates("blob")).toEqual(["blob"]);
    expect(resolveMediaUploadCandidates("s3")).toEqual(["s3"]);
    expect(resolveMediaUploadCandidates("dbblob")).toEqual(["dbblob"]);
    expect(resolveMediaUploadCandidates("auto")).toEqual(["blob", "s3", "dbblob"]);
  });

  it("does not send an S3 object ACL unless explicitly requested", () => {
    expect(resolveS3ObjectAcl("")).toBeUndefined();
    expect(resolveS3ObjectAcl("private")).toBeUndefined();
    expect(resolveS3ObjectAcl("public-read")).toBe("public-read");
  });

  it("builds canonical public S3 object URLs", () => {
    expect(buildS3ObjectUrl("bucket-name", "site/file.png", "us-east-1")).toBe(
      "https://bucket-name.s3.amazonaws.com/site/file.png",
    );
    expect(buildS3ObjectUrl("bucket-name", "site/file.png", "us-west-2")).toBe(
      "https://bucket-name.s3.us-west-2.amazonaws.com/site/file.png",
    );
  });
});
