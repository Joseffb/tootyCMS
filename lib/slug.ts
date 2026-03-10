export const MAX_SEO_SLUG_LENGTH = 80;

function normalizeSlugCore(input: string) {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+/g, "")
    .slice(0, MAX_SEO_SLUG_LENGTH);
}

export function normalizeSlugDraft(input: string) {
  return normalizeSlugCore(input);
}

export function normalizeSeoSlug(input: string) {
  return normalizeSlugCore(input).replace(/-+$/g, "");
}
