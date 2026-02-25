import crypto from "node:crypto";
import { trace } from "@/lib/debug";

export type SignaturePolicy = "off" | "warn" | "enforce";

export function getSignaturePolicy(): SignaturePolicy {
  const raw = String(process.env.TOOTY_SIGNATURE_POLICY || "off").trim().toLowerCase();
  if (raw === "warn" || raw === "enforce") return raw;
  return "off";
}

export function sha256Hex(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function hmacSha256Hex(secret: string, input: string) {
  return crypto.createHmac("sha256", secret).update(input).digest("hex");
}

export type OutboundSignature = {
  signature: string;
  payloadHash: string;
  timestamp: string;
};

export function signCanonicalPayload(input: {
  canonicalPayloadJson: string;
  secret?: string | null;
  timestamp?: string;
}): OutboundSignature {
  const timestamp = input.timestamp || new Date().toISOString();
  const payloadHash = sha256Hex(input.canonicalPayloadJson);
  const toSign = `${timestamp}.${payloadHash}`;
  const secret = String(input.secret || "").trim();
  if (!secret) {
    return {
      signature: "unsigned",
      payloadHash,
      timestamp,
    };
  }
  return {
    signature: hmacSha256Hex(secret, toSign),
    payloadHash,
    timestamp,
  };
}

export async function verifyInboundSignature(input: {
  context: "communications-callback" | "webcallback";
  headers: Record<string, string>;
  rawBody: string;
  secret?: string | null;
}) {
  const policy = getSignaturePolicy();
  const providedSignature = String(input.headers["x-tooty-signature"] || "").trim();
  const providedTimestamp = String(input.headers["x-tooty-timestamp"] || "").trim();
  const secret = String(input.secret || "").trim();
  const payloadHash = sha256Hex(input.rawBody || "");

  if (!providedSignature || !providedTimestamp || !secret) {
    const reason = !secret ? "secret_missing" : "signature_or_timestamp_missing";
    if (policy === "enforce") {
      return { ok: false as const, reason, payloadHash };
    }
    if (policy === "warn") {
      trace("signing", "signature not enforced but missing", {
        context: input.context,
        reason,
      });
    }
    return { ok: true as const, reason, payloadHash };
  }

  const expected = hmacSha256Hex(secret, `${providedTimestamp}.${payloadHash}`);
  if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(providedSignature))) {
    return { ok: true as const, reason: "verified", payloadHash };
  }
  if (policy === "enforce") {
    return { ok: false as const, reason: "signature_invalid", payloadHash };
  }
  trace("signing", "signature invalid but not enforced", {
    context: input.context,
    reason: "signature_invalid",
  });
  return { ok: true as const, reason: "signature_invalid", payloadHash };
}

