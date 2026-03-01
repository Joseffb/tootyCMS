(() => {
  if (typeof document === "undefined") return;

  const BRIDGE_STORAGE_KEY = "tooty.themeAuthBridge.v1";
  const DEFAULT_PERMISSIONS = {
    canViewComments: true,
    isAuthenticated: false,
    canPostAsUser: false,
    canPostAnonymously: true,
    canPostAuthenticated: true,
    anonymousIdentityFields: {
      name: true,
      email: true,
    },
  };

  function decodeTokenExp(token) {
    const normalized = String(token || "").trim();
    if (!normalized) return null;
    const parts = normalized.split(".");
    if (parts.length < 2) return null;
    try {
      const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const padded = payload + "=".repeat((4 - (payload.length % 4 || 4)) % 4);
      const json = JSON.parse(window.atob(padded));
      const exp = Number(json?.exp);
      return Number.isFinite(exp) ? exp : null;
    } catch {
      return null;
    }
  }

  function isTokenUsable(token) {
    const normalized = String(token || "").trim();
    if (!normalized) return false;
    const exp = decodeTokenExp(normalized);
    if (!exp) return true;
    const now = Math.floor(Date.now() / 1000);
    return exp - 20 > now;
  }

  function readStoredBridgeAuth() {
    try {
      const raw = window.localStorage.getItem(BRIDGE_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const token = String(parsed?.token || "").trim();
      if (!token || !isTokenUsable(token)) return null;
      return {
        ready: true,
        token,
        user: parsed?.user || null,
      };
    } catch {
      return null;
    }
  }

  async function ensureBridgeAuth(options) {
    const waitForResolver = Boolean(options?.wait);
    try {
      if (window.__tootyFrontendAuth?.ready && window.__tootyFrontendAuth?.token) {
        return window.__tootyFrontendAuth;
      }
      const cached = readStoredBridgeAuth();
      if (cached?.token) return cached;
      if (waitForResolver) {
        const resolver = window.__tootyResolveFrontendAuth;
        if (typeof resolver === "function") {
          return await resolver();
        }
      }
      return window.__tootyFrontendAuth || cached || { ready: false, token: "", user: null };
    } catch {
      return { ready: false, token: "", user: null };
    }
  }

  async function loadCommentPayload(siteId, contextId, options) {
    const auth = await ensureBridgeAuth({ wait: Boolean(options?.waitForAuth) });
    const headers = {};
    if (auth?.token) headers["x-tooty-theme-bridge"] = auth.token;
    const params = new URLSearchParams({
      siteId,
      contextType: "entry",
      contextId,
      limit: "100",
      offset: "0",
    });
    if (options?.capabilitiesOnly) params.set("view", "capabilities");
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeoutId = controller
      ? window.setTimeout(() => controller.abort(), Math.max(500, Number(options?.timeoutMs || 5000)))
      : null;
    try {
      const response = await fetch(`/api/comments?${params.toString()}`, {
        credentials: "same-origin",
        headers,
        signal: controller ? controller.signal : undefined,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) {
        throw new Error(String(data?.error || "Failed to load comments."));
      }
      return {
        items: Array.isArray(data.items) ? data.items : [],
        permissions: data.permissions && typeof data.permissions === "object" ? data.permissions : {},
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Comments request timed out.");
      }
      throw error;
    } finally {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    }
  }

  async function createComment(siteId, contextId, body, anonymousIdentity) {
    const auth = await ensureBridgeAuth({ wait: true });
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

  function readDataBoolean(block, key) {
    const raw = String(block?.dataset?.[key] || "").trim().toLowerCase();
    if (!raw) return false;
    return ["1", "true", "yes", "on", "enabled"].includes(raw);
  }

  function createBootstrapPermissions(block) {
    const hasExplicitBootstrapPermissions = readDataBoolean(block, "commentsBootstrapReady");
    return {
      ...DEFAULT_PERMISSIONS,
      canPostAnonymously: hasExplicitBootstrapPermissions
        ? readDataBoolean(block, "canPostAnonymously")
        : true,
      canPostAuthenticated: hasExplicitBootstrapPermissions
        ? readDataBoolean(block, "canPostAuthenticated")
        : true,
      anonymousIdentityFields: {
        name: hasExplicitBootstrapPermissions
          ? readDataBoolean(block, "anonymousNameRequired")
          : true,
        email: hasExplicitBootstrapPermissions
          ? readDataBoolean(block, "anonymousEmailRequired")
          : true,
      },
    };
  }

  function captureTemplates(block) {
    const itemTemplate = String(block.querySelector("[data-comments-item-template]")?.innerHTML || "").trim();
    const formTemplate = String(block.querySelector("[data-comments-form-template]")?.innerHTML || "").trim();
    const starterVariant =
      Boolean(itemTemplate) ||
      Boolean(formTemplate) ||
      block.classList.contains("starter-comments-block");
    return {
      variant: starterVariant ? "starter" : "default",
      itemTemplate,
      formTemplate,
    };
  }

  function renderShell(block, templates) {
    if (templates.variant === "starter") {
      const formMarkup =
        templates.formTemplate ||
        `<form class="starter-comments-form" data-comments-form>
          <label data-comment-field="author-name" style="display:none">
            <span>Display Name</span>
            <input name="authorName" maxlength="120" placeholder="Display Name" />
          </label>
          <label data-comment-field="author-email" style="display:none">
            <span>Email (never shown)</span>
            <input name="authorEmail" type="email" maxlength="320" placeholder="Email (never shown)" />
          </label>
          <textarea name="body" rows="4" maxlength="2000" placeholder="Write a comment..."></textarea>
          <div class="starter-comments-actions">
            <button type="submit">Post Comment</button>
            <span data-comments-status></span>
          </div>
        </form>`;
      block.innerHTML = `
        <div class="starter-comments-card">
          <h3 class="starter-comments-title">Comments</h3>
          <p class="starter-comments-note" data-comments-note>Loading comments...</p>
          <div class="starter-comments-list" data-comments-list></div>
        </div>
        <div class="starter-comments-card starter-comments-compose" data-comments-compose style="display:none">
          ${formMarkup}
        </div>
      `;
      return;
    }

    block.innerHTML = `
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
    `;
  }

  function buildState(block) {
    const templates = captureTemplates(block);
    renderShell(block, templates);
    const form = block.querySelector("[data-comments-form]");
    return {
      block,
      templates,
      list: block.querySelector("[data-comments-list]"),
      compose: block.querySelector("[data-comments-compose]"),
      form,
      status: block.querySelector("[data-comments-status]"),
      note: block.querySelector("[data-comments-note]"),
      nameLabel: form?.querySelector("[data-comment-field='author-name']"),
      emailLabel: form?.querySelector("[data-comment-field='author-email']"),
      nameInput: form?.querySelector("input[name='authorName']"),
      emailInput: form?.querySelector("input[name='authorEmail']"),
      textarea: form?.querySelector("textarea"),
      submitButton: form?.querySelector("button[type='submit']"),
      permissions: createBootstrapPermissions(block),
      bridgeKnownUser: null,
      redrawSequence: 0,
      hasResolvedPermissions: false,
      submitting: false,
    };
  }

  function normalizePermissions(nextPermissions, fallbackPermissions) {
    const merged = {
      ...DEFAULT_PERMISSIONS,
      ...(fallbackPermissions || {}),
      ...(nextPermissions || {}),
    };
    merged.anonymousIdentityFields = {
      ...DEFAULT_PERMISSIONS.anonymousIdentityFields,
      ...(fallbackPermissions?.anonymousIdentityFields || {}),
      ...(nextPermissions?.anonymousIdentityFields || {}),
    };
    return merged;
  }

  function applyPermissions(state, nextPermissions) {
    state.permissions = normalizePermissions(nextPermissions, state.permissions);
    if (nextPermissions) state.hasResolvedPermissions = true;
    const permissions = state.permissions;
    const canViewComments = permissions.canViewComments !== false;
    const isAuthenticated = Boolean(permissions.isAuthenticated);
    const canPostAsUser =
      Boolean(permissions.canPostAsUser) && state.bridgeKnownUser === true;
    const canPostAnonymously = Boolean(permissions.canPostAnonymously);
    const canWriteComments = canPostAsUser || canPostAnonymously;
    const requiresAnonymousIdentity = !canPostAsUser && canWriteComments && canPostAnonymously;
    const identityFields = permissions.anonymousIdentityFields || {};

    if (state.note) {
      state.note.textContent = !canViewComments
        ? "Comments are not visible for this audience."
        : canPostAsUser
          ? "You can post comments as a signed-in user."
          : isAuthenticated && requiresAnonymousIdentity
            ? "You are signed in, but this account cannot post as an internal user. Add name and email to post as guest."
            : canPostAnonymously
              ? "Guests can post comments. Display name and email are required (email is never shown)."
              : "Comments are read-only for your current access.";
    }

    if (state.compose instanceof HTMLElement) {
      state.compose.style.display = canWriteComments ? "" : "none";
    } else if (state.form instanceof HTMLElement) {
      state.form.style.display = canWriteComments ? "" : "none";
    }

    if (state.nameInput instanceof HTMLInputElement) {
      const enabled = requiresAnonymousIdentity && Boolean(identityFields.name);
      if (state.nameLabel instanceof HTMLElement) state.nameLabel.style.display = enabled ? "" : "none";
      else state.nameInput.style.display = enabled ? "" : "none";
      state.nameInput.required = enabled;
    }

    if (state.emailInput instanceof HTMLInputElement) {
      const enabled = requiresAnonymousIdentity && Boolean(identityFields.email);
      if (state.emailLabel instanceof HTMLElement) state.emailLabel.style.display = enabled ? "" : "none";
      else state.emailInput.style.display = enabled ? "" : "none";
      state.emailInput.required = enabled;
    }

    return { canViewComments };
  }

  function applyOptimisticBridgePermissions(state, auth) {
    const hasToken = Boolean(String(auth?.token || "").trim());
    if (!hasToken) {
      state.bridgeKnownUser = null;
      return;
    }
    const knownUser = auth?.user?.knownUser;
    if (knownUser === true) {
      state.bridgeKnownUser = true;
      applyPermissions(state, {
        isAuthenticated: true,
        canPostAsUser: Boolean(state.permissions?.canPostAuthenticated),
      });
      return;
    }
    if (knownUser === false) {
      state.bridgeKnownUser = false;
      applyPermissions(state, {
        isAuthenticated: true,
        canPostAsUser: false,
      });
      return;
    }
    state.bridgeKnownUser = null;
  }

  function formatCreatedAt(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return raw;
    return parsed.toLocaleString();
  }

  function renderDefaultCommentItem(item) {
    const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
    const displayName = String(
      metadata.author_display_name || metadata.author_name || item?.authorName || "Anonymous",
    ).trim() || "Anonymous";
    const createdAt = formatCreatedAt(item?.createdAt);
    const status = String(item?.status || "").trim();
    return `
      <article class="tooty-comment-item">
        <header>
          <span>${escapeHtml(displayName)}</span>
          <span>${escapeHtml(createdAt)}</span>
        </header>
        ${status ? `<div class="tooty-comment-status">${escapeHtml(status)}</div>` : ""}
        <p>${escapeHtml(item?.body || "")}</p>
      </article>
    `;
  }

  function renderStarterCommentItem(template, item) {
    const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
    const replacements = {
      display_name: String(
        metadata.author_display_name || metadata.author_name || item?.authorName || "Anonymous",
      ).trim() || "Anonymous",
      created_at: formatCreatedAt(item?.createdAt),
      body: String(item?.body || ""),
      status: String(item?.status || ""),
    };
    return template.replace(/\[\[(display_name|created_at|body|status)\]\]/g, (_match, token) =>
      escapeHtml(replacements[token] || ""),
    );
  }

  function renderItems(state, items) {
    if (!(state.list instanceof HTMLElement)) return;
    if (!items.length) {
      const emptyClass = state.templates.variant === "starter" ? "starter-comments-empty" : "tooty-comments-empty";
      state.list.innerHTML = `<p class="${emptyClass}">No comments yet.</p>`;
      return;
    }

    if (state.templates.variant === "starter" && state.templates.itemTemplate) {
      state.list.innerHTML = items.map((item) => renderStarterCommentItem(state.templates.itemTemplate, item)).join("");
      return;
    }

    state.list.innerHTML = items.map((item) => renderDefaultCommentItem(item)).join("");
  }

  async function refreshCapabilities(state, options) {
    const sequence = ++state.redrawSequence;
    try {
      if (!state.hasResolvedPermissions) applyPermissions(state);
      const payload = await loadCommentPayload(
        String(state.block.dataset.siteId || "").trim(),
        String(state.block.dataset.contextId || "").trim(),
        {
          capabilitiesOnly: true,
          timeoutMs: 7000,
          waitForAuth: Boolean(options?.waitForAuth),
        },
      );
      if (sequence !== state.redrawSequence) return false;
      const { canViewComments } = applyPermissions(state, payload.permissions);
      if (!canViewComments) {
        if (state.list instanceof HTMLElement) {
          const emptyClass = state.templates.variant === "starter" ? "starter-comments-empty" : "tooty-comments-empty";
          state.list.innerHTML = `<p class="${emptyClass}">Comments are not available.</p>`;
        }
        return false;
      }
      return true;
    } catch (error) {
      if (sequence !== state.redrawSequence) return false;
      applyPermissions(state);
      if (state.list instanceof HTMLElement) {
        const emptyClass = state.templates.variant === "starter" ? "starter-comments-empty" : "tooty-comments-empty";
        const message = error instanceof Error ? error.message : "Comments are temporarily unavailable.";
        state.list.innerHTML = `<p class="${emptyClass}">${escapeHtml(message || "Comments are temporarily unavailable.")}</p>`;
      }
      if (state.note) {
        state.note.textContent = "Comments are temporarily unavailable.";
      }
      return false;
    }
  }

  async function refreshItems(state) {
    const sequence = state.redrawSequence;
    try {
      const payload = await loadCommentPayload(
        String(state.block.dataset.siteId || "").trim(),
        String(state.block.dataset.contextId || "").trim(),
        {
          timeoutMs: 10000,
          waitForAuth: false,
        },
      );
      if (sequence !== state.redrawSequence) return;
      renderItems(state, payload.items);
    } catch (error) {
      if (sequence !== state.redrawSequence) return;
      if (state.list instanceof HTMLElement) {
        const emptyClass = state.templates.variant === "starter" ? "starter-comments-empty" : "tooty-comments-empty";
        const message = error instanceof Error ? error.message : "Comments are temporarily unavailable.";
        state.list.innerHTML = `<p class="${emptyClass}">${escapeHtml(message || "Comments are temporarily unavailable.")}</p>`;
      }
      if (state.note && /loading comments/i.test(String(state.note.textContent || ""))) {
        state.note.textContent = "Comments are temporarily unavailable.";
      }
    }
  }

  async function refreshComments(state, options) {
    const canViewComments = await refreshCapabilities(state, options);
    if (!canViewComments) {
      return;
    }
    await refreshItems(state);
  }

  function bindSubmit(state) {
    if (!(state.form instanceof HTMLFormElement)) return;
    state.form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (state.submitting) return;
      const body = String(state.textarea?.value || "").trim();
      if (!body) {
        if (state.status) state.status.textContent = "Comment text is required.";
        return;
      }

      const anonymousIdentity = {
        name: String(state.nameInput?.value || "").trim(),
        email: String(state.emailInput?.value || "").trim(),
      };

      if (state.status) state.status.textContent = "Posting...";
      if (state.submitButton instanceof HTMLButtonElement) state.submitButton.disabled = true;
      state.submitting = true;
      try {
        await createComment(
          String(state.block.dataset.siteId || "").trim(),
          String(state.block.dataset.contextId || "").trim(),
          body,
          anonymousIdentity,
        );
        if (state.textarea instanceof HTMLTextAreaElement) state.textarea.value = "";
        if (state.nameInput instanceof HTMLInputElement) state.nameInput.value = "";
        if (state.emailInput instanceof HTMLInputElement) state.emailInput.value = "";
        if (state.status) state.status.textContent = "Comment posted.";
        await refreshComments(state, { waitForAuth: true });
      } catch (error) {
        if (state.status) {
          state.status.textContent =
            error instanceof Error ? error.message : "Failed to post comment.";
        }
      } finally {
        state.submitting = false;
        if (state.submitButton instanceof HTMLButtonElement) state.submitButton.disabled = false;
      }
    });
  }

  function bindAuthRefresh(state) {
    let observedToken = String(window.__tootyFrontendAuth?.token || readStoredBridgeAuth()?.token || "").trim();
    const handler = () => {
      const auth = window.__tootyFrontendAuth || readStoredBridgeAuth();
      const nextToken = String(auth?.token || "").trim();
      const tokenChanged = nextToken !== observedToken;
      if (!tokenChanged) return;
      observedToken = nextToken;
      applyOptimisticBridgePermissions(state, auth);
      void refreshComments(state, { waitForAuth: Boolean(nextToken) });
    };
    window.addEventListener("tooty:auth-changed", handler);
    const onStorage = (event) => {
      if (event?.key !== BRIDGE_STORAGE_KEY) return;
      const auth = window.__tootyFrontendAuth || readStoredBridgeAuth();
      const nextToken = String(auth?.token || "").trim();
      const tokenChanged = nextToken !== observedToken;
      if (!tokenChanged) return;
      observedToken = nextToken;
      applyOptimisticBridgePermissions(state, auth);
      void refreshComments(state, { waitForAuth: Boolean(nextToken) });
    };
    window.addEventListener("storage", onStorage);
    let attempts = 0;
    const pollId = window.setInterval(() => {
      attempts += 1;
      const auth = window.__tootyFrontendAuth || readStoredBridgeAuth();
      const nextToken = String(auth?.token || "").trim();
      if (nextToken && nextToken !== observedToken) {
        observedToken = nextToken;
        window.clearInterval(pollId);
        applyOptimisticBridgePermissions(state, auth);
        void refreshComments(state, { waitForAuth: true });
        return;
      }
      if (attempts >= 20) {
        window.clearInterval(pollId);
      }
    }, 250);
    state.block.addEventListener(
      "tooty:comments:cleanup",
      () => {
        window.removeEventListener("tooty:auth-changed", handler);
        window.removeEventListener("storage", onStorage);
        window.clearInterval(pollId);
      },
      { once: true },
    );
  }

  async function renderBlock(block) {
    if (!(block instanceof HTMLElement)) return;
    if (block.dataset.commentsReady === "1") return;
    const siteId = String(block.dataset.siteId || "").trim();
    const contextId = String(block.dataset.contextId || "").trim();
    if (!siteId || !contextId) return;
    block.dataset.commentsReady = "1";
    const state = buildState(block);
    applyPermissions(state);
    bindSubmit(state);
    bindAuthRefresh(state);
    const initialAuth = window.__tootyFrontendAuth || readStoredBridgeAuth();
    const hasInitialBridgeToken = Boolean(String(initialAuth?.token || "").trim());
    if (hasInitialBridgeToken) {
      applyOptimisticBridgePermissions(state, initialAuth);
      await refreshComments(state, { waitForAuth: true });
      return;
    }
    await refreshComments(state, { waitForAuth: false });
  }

  async function start() {
    const blocks = Array.from(document.querySelectorAll("[data-tooty-comments]"));
    for (const block of blocks) {
      await renderBlock(block);
    }
  }

  window.addEventListener("beforeunload", () => {
    const blocks = Array.from(document.querySelectorAll("[data-tooty-comments]"));
    for (const block of blocks) {
      block.dispatchEvent(new CustomEvent("tooty:comments:cleanup"));
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        void start();
      },
      { once: true },
    );
  } else {
    void start();
  }
})();
