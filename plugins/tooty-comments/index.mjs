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
  return `<div data-theme-slot="comments" class="tooty-comments-block" data-tooty-comments data-comments-block data-site-id="${escapeAttr(siteId)}" data-context-id="${escapeAttr(contextId)}"></div>`;
}

export async function register(kernel, api) {
  if (api?.registerCommentProvider && api?.core?.comments?.createTableBackedProvider) {
    try {
      api.registerCommentProvider(
        api.core.comments.createTableBackedProvider({
          id: "tooty-comments",
        }),
      );
    } catch (error) {
      const message = String(error?.message || "");
      if (!message.includes("requires a bound site plugin context")) {
        throw error;
      }
    }
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

    const capabilities = await api.core.comments.getPublicCapabilities(siteId);
    const commentsEnabled = Boolean(
      capabilities.commentsVisibleToPublic ||
        capabilities.canPostAuthenticated ||
        capabilities.canPostAnonymously,
    );
    const useComments = readMetaBoolean(entry?.meta, "use_comments", commentsEnabled);
    if (!commentsEnabled || !useComments) return slots;

    slots.comments = buildCommentsSlotMarkup({
      siteId,
      contextId: entryId,
    });
    return slots;
  });
}
