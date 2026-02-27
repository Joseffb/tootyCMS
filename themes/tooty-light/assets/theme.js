(function () {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-tooty-theme", "tooty-light");

  if (window.__tootyThemeArtMounted) return;
  window.__tootyThemeArtMounted = true;

  const nonLibraryNames = [
    "tooty-thumbs-up.png",
    "tooty-notebook.png",
    "tooty-laptop.png",
    "tooty-surf.png",
    "tooty-scooter.png",
    "tooty-camera.png",
    "tooty-nap.png",
    "tooty-megaphone.png",
    "tooty-ideas.png",
    "tooty-heart.png",
  ];

  function pickRandomName() {
    return nonLibraryNames[Math.floor(Math.random() * nonLibraryNames.length)];
  }

  function renderThemeArtSlots() {
    const slots = document.querySelectorAll("[data-theme-slot='header-art']");
    slots.forEach((slot) => {
      if (!(slot instanceof HTMLElement)) return;
      if (slot.dataset.themeArtReady === "1") return;

      const context = slot.closest("[data-theme-context]");
      const docSlug = (context?.getAttribute("data-theme-doc-category-slug") || "documentation").toLowerCase();
      const termSlug = (context?.getAttribute("data-theme-term-slug") || "").toLowerCase();
      const categorySlugs = (context?.getAttribute("data-theme-category-slugs") || "")
        .split(",")
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean);
      const publicBase = (context?.getAttribute("data-theme-public-image-base") || "/theme-assets/tooty-light").replace(/\/+$/, "");

      const isDocumentation = termSlug === docSlug || categorySlugs.includes(docSlug);
      const fileName = isDocumentation ? "tooty-reading.png" : pickRandomName();
      const src = `${publicBase}/mascots/${fileName}`;

      const img = document.createElement("img");
      img.src = src;
      img.alt = "Theme art";
      img.className = "theme-header-art-image";
      slot.appendChild(img);
      slot.dataset.themeArtReady = "1";
    });
  }

  const start = () => {
    renderThemeArtSlots();
    window.setTimeout(() => {
      renderThemeArtSlots();
    }, 0);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();

(() => {
  if (typeof document === "undefined") return;

  async function ensureBridgeAuth() {
    try {
      if (window.__tootyFrontendAuth?.ready && window.__tootyFrontendAuth?.token) {
        return window.__tootyFrontendAuth;
      }
      const resolver = window.__tootyResolveFrontendAuth;
      if (typeof resolver === "function") return await resolver();
      return window.__tootyFrontendAuth || { ready: true, token: "", user: null };
    } catch {
      return { ready: true, token: "", user: null };
    }
  }

  async function loadComments(siteId, contextId) {
    const auth = await ensureBridgeAuth();
    const headers = {};
    if (auth?.token) headers["x-tooty-theme-bridge"] = auth.token;
    const params = new URLSearchParams({
      siteId,
      contextType: "entry",
      contextId,
      limit: "100",
      offset: "0",
    });
    const response = await fetch(`/api/comments?${params.toString()}`, {
      credentials: "same-origin",
      headers,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) {
      throw new Error(String(data?.error || "Failed to load comments."));
    }
    return {
      items: Array.isArray(data.items) ? data.items : [],
      permissions: data.permissions && typeof data.permissions === "object" ? data.permissions : {},
    };
  }

  async function createComment(siteId, contextId, body, anonymousIdentity) {
    const auth = await ensureBridgeAuth();
    const headers = { "Content-Type": "application/json" };
    if (auth?.token) headers["x-tooty-theme-bridge"] = auth.token;
    const response = await fetch("/api/comments", {
      method: "POST",
      headers,
      credentials: "same-origin",
      body: JSON.stringify({
        siteId,
        contextType: "entry",
        contextId,
        body,
        authorName: anonymousIdentity?.name || "",
        authorEmail: anonymousIdentity?.email || "",
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) {
      throw new Error(String(data?.error || "Failed to post comment."));
    }
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function renderBlock(block) {
    if (!(block instanceof HTMLElement)) return;
    if (block.dataset.commentsReady === "1") return;
    const siteId = String(block.dataset.siteId || "").trim();
    const contextId = String(block.dataset.contextId || "").trim();
    if (!siteId || !contextId) return;
    block.dataset.commentsReady = "1";

    block.innerHTML = `
      <div class="tooty-comments-card">
        <h3 class="tooty-comments-title">Comments</h3>
        <p class="tooty-comments-note" data-comments-note></p>
        <div class="tooty-comments-list" data-comments-list>Loading comments...</div>
      </div>
      <div class="tooty-comments-card tooty-comments-compose" data-comments-compose>
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
    `;
    const list = block.querySelector("[data-comments-list]");
    const compose = block.querySelector("[data-comments-compose]");
    const form = block.querySelector("[data-comments-form]");
    const status = block.querySelector("[data-comments-status]");
    const note = block.querySelector("[data-comments-note]");
    const nameLabel = form?.querySelector("[data-comment-field='author-name']");
    const emailLabel = form?.querySelector("[data-comment-field='author-email']");
    const nameInput = form?.querySelector("input[name='authorName']");
    const emailInput = form?.querySelector("input[name='authorEmail']");
    const textarea = form?.querySelector("textarea");
    const submitButton = form?.querySelector("button[type='submit']");
    let permissions = { canPostAsUser: false, canPostAnonymously: false, anonymousIdentityFields: {} };
    let submitting = false;
    await ensureBridgeAuth();

    const redraw = async () => {
      if (!list) return;
      try {
        const payload = await loadComments(siteId, contextId);
        const items = payload.items;
        permissions = payload.permissions || permissions;
        const canViewComments = permissions.canViewComments !== false;
        const isAuthenticated = Boolean(permissions.isAuthenticated);
        const canPostAsUser = Boolean(permissions.canPostAsUser);
        const canPostAnonymously = Boolean(permissions.canPostAnonymously);
        const canWriteComments = canPostAsUser || canPostAnonymously;
        const identityFields = permissions.anonymousIdentityFields || {};
        if (note) {
          note.textContent = !canViewComments
            ? "Comments are not visible for this audience."
            : canPostAsUser
            ? "You can post comments as a signed-in user."
            : isAuthenticated && canPostAnonymously
              ? "You are signed in. Comments will use your account identity."
            : canPostAnonymously
              ? "Guests can post comments. Display name and email are required (email is never shown)."
              : "Comments are read-only for your current access.";
        }
        if (compose instanceof HTMLElement) {
          compose.style.display = canWriteComments ? "" : "none";
        } else if (form) {
          form.style.display = canWriteComments ? "" : "none";
        }
        if (nameInput instanceof HTMLInputElement) {
          const enabled = !isAuthenticated && !canPostAsUser && canWriteComments && canPostAnonymously && Boolean(identityFields.name);
          if (nameLabel instanceof HTMLElement) nameLabel.style.display = enabled ? "" : "none";
          else nameInput.style.display = enabled ? "" : "none";
          nameInput.required = enabled;
        }
        if (emailInput instanceof HTMLInputElement) {
          const enabled = !isAuthenticated && !canPostAsUser && canWriteComments && canPostAnonymously && Boolean(identityFields.email);
          if (emailLabel instanceof HTMLElement) emailLabel.style.display = enabled ? "" : "none";
          else emailInput.style.display = enabled ? "" : "none";
          emailInput.required = enabled;
        }
        if (!canViewComments) {
          list.innerHTML = '<p class="tooty-comments-empty">Comments are not available.</p>';
          return;
        }
        if (!items.length) {
          list.innerHTML = '<p class="tooty-comments-empty">No comments yet.</p>';
          return;
        }
        list.innerHTML = items
          .map((item) => {
            const body = escapeHtml(item.body || "");
            const created = new Date(String(item.createdAt || ""));
            const createdLabel = Number.isNaN(created.getTime()) ? "" : created.toLocaleString();
            const metadata = item && typeof item.metadata === "object" ? item.metadata : {};
            const displayNameRaw = String(
              metadata.author_display_name ||
                metadata.display_name ||
                metadata.author_name ||
                "",
            );
            const displayName = displayNameRaw ? `<span>${escapeHtml(displayNameRaw)}</span>` : "";
            return `
              <article class="tooty-comment-item">
                <header>
                  ${displayName}
                  <time>${escapeHtml(createdLabel)}</time>
                </header>
                <p>${body}</p>
              </article>
            `;
          })
          .join("");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load comments.";
        list.innerHTML = `<p class="tooty-comments-empty">${escapeHtml(message)}</p>`;
      }
    };

    if (form && textarea) {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (submitting) return;
        const body = textarea.value.trim();
        if (!body) return;
        submitting = true;
        if (submitButton instanceof HTMLButtonElement) submitButton.disabled = true;
        if (status) status.textContent = "Posting...";
        try {
          await createComment(siteId, contextId, body, {
            name: nameInput instanceof HTMLInputElement ? nameInput.value.trim() : "",
            email: emailInput instanceof HTMLInputElement ? emailInput.value.trim() : "",
          });
          textarea.value = "";
          if (nameInput instanceof HTMLInputElement) nameInput.value = "";
          if (emailInput instanceof HTMLInputElement) emailInput.value = "";
          if (status) status.textContent = "Posted.";
          await redraw();
        } catch (error) {
          if (status) status.textContent = error instanceof Error ? error.message : "Post failed.";
        } finally {
          submitting = false;
          if (submitButton instanceof HTMLButtonElement) submitButton.disabled = false;
        }
      });
    }

    await redraw();
  }

  const renderPendingBlocks = () => {
    const blocks = Array.from(document.querySelectorAll("[data-tooty-comments]"));
    for (const block of blocks) {
      void renderBlock(block);
    }
  };

  const start = () => {
    void ensureBridgeAuth();
    renderPendingBlocks();
    window.setTimeout(() => {
      renderPendingBlocks();
    }, 0);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
