import type { PublicCommentCapabilities } from "@/lib/comments-spine";

function escapeAttribute(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function booleanAttr(value: boolean) {
  return value ? "true" : "false";
}

function buildCommentsShell(existingAttributes: string, capabilities: PublicCommentCapabilities) {
  const attrs = String(existingAttributes || "").trim();
  const anonymousFields = capabilities?.anonymousIdentityFields || { name: false, email: false };
  return `<div ${attrs} data-comments-bootstrap-ready="true" data-can-post-anonymously="${escapeAttribute(booleanAttr(Boolean(capabilities?.canPostAnonymously)))}" data-can-post-authenticated="${escapeAttribute(booleanAttr(Boolean(capabilities?.canPostAuthenticated)))}" data-anonymous-name-required="${escapeAttribute(booleanAttr(Boolean(anonymousFields.name)))}" data-anonymous-email-required="${escapeAttribute(booleanAttr(Boolean(anonymousFields.email)))}">
  <div class="tooty-comments-card">
    <h3 class="tooty-comments-title">Comments</h3>
    <p class="tooty-comments-note" data-comments-note>Loading comments...</p>
    <div class="tooty-comments-list" data-comments-list></div>
  </div>
  <div class="tooty-comments-card tooty-comments-compose" data-comments-compose style="display:none">
    <form class="tooty-comments-form" data-comments-form>
      <label data-comment-field="author-name" style="display:none">
        <span>Display Name</span>
        <input name="authorName" maxlength="120" placeholder="Display Name" />
      </label>
      <label data-comment-field="author-email" style="display:none">
        <span>Email (never shown)</span>
        <input name="authorEmail" type="email" maxlength="320" placeholder="Email (never shown)" />
      </label>
      <textarea name="body" rows="4" maxlength="2000" placeholder="Write a comment..."></textarea>
      <div class="tooty-comments-actions">
        <button type="submit">Post Comment</button>
        <span data-comments-status></span>
      </div>
    </form>
  </div>
</div>`;
}

export function hydrateCommentsSlotMarkup(html: string, capabilities: PublicCommentCapabilities) {
  const source = String(html || "");
  if (!source.includes("data-tooty-comments")) return source;
  return source.replace(
    /<div([^>]*data-tooty-comments[^>]*)>\s*<\/div>/gi,
    (_match, attributes: string) => buildCommentsShell(attributes, capabilities),
  );
}
