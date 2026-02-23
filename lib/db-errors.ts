type PgLikeError = {
  code?: string;
  message?: string;
};

export function isMissingRelationError(error: unknown): boolean {
  const candidate = (error || {}) as PgLikeError;
  if (candidate.code === "42P01") return true;
  const message = String(candidate.message || "").toLowerCase();
  return message.includes("relation") && message.includes("does not exist");
}

