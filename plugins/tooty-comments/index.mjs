function normalizeBoolean(value, fallback = true) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
  return fallback;
}

function readMetaBoolean(entries, key, fallback = true) {
  const list = Array.isArray(entries) ? entries : [];
  const match = list.find((entry) => String(entry?.key || "").trim().toLowerCase() === String(key || "").trim().toLowerCase());
  if (!match) return fallback;
  return normalizeBoolean(match?.value, fallback);
}

function escapeAttr(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildCommentsSlotMarkup({ siteId, contextId }) {
  return `<div data-theme-slot="comments" class="tooty-comments-block" data-comments-block data-site-id="${escapeAttr(siteId)}" data-context-id="${escapeAttr(contextId)}"></div>`;
}

export async function register(kernel, api) {
  if (api?.registerCommentProvider && api?.core?.comments?.createTableBackedProvider) {
    api.registerCommentProvider(
      api.core.comments.createTableBackedProvider({
        id: "tooty-comments",
      }),
    );
  }
  kernel.enqueueScript({
    id: "tooty-comments-widget",
    src: "/plugin-assets/tooty-comments/comments-widget.js",
  });
  kernel.addFilter("theme:slots", async (current = {}, context = {}) => {
    const slots = current && typeof current === "object" ? { ...current } : {};
    if (String(context?.routeKind || "").trim() !== "domain_detail") return slots;
    const siteId = String(context?.siteId || "").trim();
    const entry = context?.entry && typeof context.entry === "object" ? context.entry : null;
    const entryId = String(entry?.id || "").trim();
    if (!siteId || !entryId) return slots;

    const commentsEnabled = normalizeBoolean(await api.getSetting("enable_comments", "true"), true);
    const useComments = readMetaBoolean(entry?.meta, "use_comments", commentsEnabled);
    if (!commentsEnabled || !useComments) return slots;

    slots.comments = buildCommentsSlotMarkup({
      siteId,
      contextId: entryId,
    });
    return slots;
  });
}
