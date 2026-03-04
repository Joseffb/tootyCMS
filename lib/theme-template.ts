import nunjucks from "nunjucks/browser/nunjucks";
import { buildThemeSystemContext } from "@/lib/theme-system-context";

const env = new nunjucks.Environment(undefined, {
  autoescape: true,
  throwOnUndefined: false,
  trimBlocks: true,
  lstripBlocks: true,
});

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripMarkup(value: string) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"');
}

function collectPlainText(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === "object") {
        return collectPlainText(parsed);
      }
    } catch {
      // Keep raw string handling below.
    }
    return [stripMarkup(trimmed)];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectPlainText(entry));
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const chunks: string[] = [];
  if (typeof record.text === "string" && record.text.trim()) {
    chunks.push(record.text);
  }
  if (typeof record.description === "string" && record.description.trim()) {
    chunks.push(record.description);
  }
  if (typeof record.content === "string" && record.content.trim()) {
    chunks.push(...collectPlainText(record.content));
  } else if (Array.isArray(record.content)) {
    chunks.push(...collectPlainText(record.content));
  }
  return chunks;
}

function toPlainText(value: unknown) {
  return collectPlainText(value)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateWords(text: string, limit: number) {
  const words = text.split(/\s+/).filter(Boolean);
  if (limit < 1 || words.length <= limit) {
    return { text, truncated: false };
  }
  return {
    text: words.slice(0, limit).join(" "),
    truncated: true,
  };
}

type ExcerptArgs = {
  continuationLabel: string;
  limit: number;
  sourceValue: unknown;
};

function resolveExcerptArgs(
  defaultSource: unknown,
  args: unknown[],
): ExcerptArgs {
  let sourceValue: unknown = defaultSource;
  let limit = 50;
  let continuationLabel = "More";

  if (typeof args[0] === "number") {
    limit = args[0];
    if (typeof args[1] === "string") {
      continuationLabel = args[1];
    }
  } else {
    if (args.length > 0) {
      sourceValue = args[0];
    }
    if (typeof args[1] === "number") {
      limit = args[1];
    }
    if (typeof args[2] === "string") {
      continuationLabel = args[2];
    }
  }

  if (!Number.isFinite(limit)) {
    limit = 50;
  }

  return {
    sourceValue,
    limit: Math.max(1, Math.floor(limit)),
    continuationLabel,
  };
}

function createThemeHelpers(payload: Record<string, unknown>) {
  const defaultSource = asRecord(payload.post);

  return {
    excerpt: (...rawArgs: unknown[]) => {
      const { sourceValue, limit, continuationLabel } = resolveExcerptArgs(defaultSource, rawArgs);
      const sourceRecord = asRecord(sourceValue);
      const sourceText =
        toPlainText(sourceRecord.content) ||
        toPlainText(sourceRecord.content_html) ||
        toPlainText(sourceRecord.body) ||
        toPlainText(sourceValue) ||
        toPlainText(defaultSource.content) ||
        toPlainText(defaultSource.content_html) ||
        toPlainText(defaultSource.body);

      if (!sourceText) {
        return new nunjucks.runtime.SafeString("");
      }

      const { text, truncated } = truncateWords(sourceText, limit);
      const href =
        (typeof sourceRecord.href === "string" && sourceRecord.href.trim()) ||
        (typeof defaultSource.href === "string" && defaultSource.href.trim()) ||
        "";
      const safeExcerpt = escapeHtml(text);
      const safeContinuationLabel = escapeHtml(String(continuationLabel || ""));

      if (!truncated) {
        return new nunjucks.runtime.SafeString(
          `<span class="theme-excerpt__text">${safeExcerpt}</span>`,
        );
      }

      if (href && safeContinuationLabel) {
        return new nunjucks.runtime.SafeString(
          `<span class="theme-excerpt__text">${safeExcerpt}</span> <a class="theme-excerpt__more" data-theme-excerpt-more href="${escapeHtml(
            href,
          )}">${safeContinuationLabel}</a>`,
        );
      }

      return new nunjucks.runtime.SafeString(
        `<span class="theme-excerpt__text">${safeExcerpt}${safeContinuationLabel ? ` ${safeContinuationLabel}` : ""}</span>`,
      );
    },
  };
}

function attachExcerptHelpersToPosts(payload: Record<string, unknown>) {
  const posts = Array.isArray(payload.posts) ? payload.posts : null;
  if (!posts) return;

  payload.posts = posts.map((entry) => {
    const postRecord = asRecord(entry);
    return {
      ...postRecord,
      excerpt: (...rawArgs: unknown[]) => {
        const helper = createThemeHelpers({
          post: postRecord,
        });
        return helper.excerpt(...rawArgs);
      },
    };
  });
}

function resolveRenderableMenus(tooty: Record<string, unknown>) {
  const menuLocations = asRecord(tooty.menuLocations);
  const resolved: Record<string, Record<string, unknown>> = {};

  for (const [location, rawMenu] of Object.entries(menuLocations)) {
    const menu = asRecord(rawMenu);
    if (Object.keys(menu).length > 0) {
      resolved[location] = menu;
    }
  }

  if (Object.keys(resolved).length > 0) return resolved;

  const menus = asRecord(tooty.menus);
  for (const [location, rawItems] of Object.entries(menus)) {
    const items = Array.isArray(rawItems) ? rawItems : [];
    if (items.length === 0) continue;
    resolved[location] = {
      key: location,
      title: location,
      location,
      items,
      flatItems: items,
    };
  }

  return resolved;
}

function renderThemeMenuItem(
  itemTemplate: string,
  item: Record<string, unknown>,
  menu: Record<string, unknown>,
  payload: Record<string, unknown>,
  depth = 0,
): string {
  const children = Array.isArray(item.children) ? item.children : [];
  const childrenHtml = children
    .map((child) => renderThemeMenuItem(itemTemplate, asRecord(child), menu, payload, depth + 1))
    .join("");

  return env.renderString(itemTemplate, {
    ...payload,
    menu,
    menu_item: item,
    item,
    depth,
    has_children: children.length > 0,
    children_html: childrenHtml,
    child_items: children,
  });
}

function renderThemeMenus(payload: Record<string, unknown>) {
  const tooty = asRecord(payload.tooty);
  const menuLocations = resolveRenderableMenus(tooty);
  const defaultMenuTemplate = typeof payload.theme_menu === "string" ? payload.theme_menu : "";
  const defaultItemTemplate = typeof payload.theme_menu_item === "string" ? payload.theme_menu_item : "";
  const menuTemplatesByLocation = asRecord(payload.theme_menu_by_location);
  const itemTemplatesByLocation = asRecord(payload.theme_menu_item_by_location);
  const menuTemplatesByLocationAndKey = asRecord(payload.theme_menu_by_location_and_key);
  const itemTemplatesByLocationAndKey = asRecord(payload.theme_menu_item_by_location_and_key);

  const renderedMenus: Record<string, string> = {};
  for (const [location, rawMenu] of Object.entries(menuLocations)) {
    const menu = asRecord(rawMenu);
    const menuKey = String(menu.key || "").trim().toLowerCase();
    const locationMenuTemplates = asRecord(menuTemplatesByLocationAndKey[location]);
    const locationItemTemplates = asRecord(itemTemplatesByLocationAndKey[location]);
    const pinnedMenuTemplate =
      menuKey && typeof locationMenuTemplates[menuKey] === "string" ? String(locationMenuTemplates[menuKey] || "") : "";
    const pinnedItemTemplate =
      menuKey && typeof locationItemTemplates[menuKey] === "string" ? String(locationItemTemplates[menuKey] || "") : "";
    const menuTemplate =
      pinnedMenuTemplate ||
      (typeof payload[`theme_menu_${location}`] === "string"
        ? String(payload[`theme_menu_${location}`] || "")
        : typeof menuTemplatesByLocation[location] === "string"
          ? String(menuTemplatesByLocation[location] || "")
          : defaultMenuTemplate);
    const itemTemplate =
      pinnedItemTemplate ||
      (typeof payload[`theme_menu_item_${location}`] === "string"
        ? String(payload[`theme_menu_item_${location}`] || "")
        : typeof itemTemplatesByLocation[location] === "string"
          ? String(itemTemplatesByLocation[location] || "")
          : defaultItemTemplate);
    if (!menuTemplate || !itemTemplate) continue;
    const items = Array.isArray(menu.items) ? menu.items : [];
    const renderedItems = items
      .map((item) => renderThemeMenuItem(itemTemplate, asRecord(item), menu, payload))
      .join("");
    renderedMenus[location] = env.renderString(menuTemplate, {
      ...payload,
      menu,
      menu_key: menuKey,
      menu_location: location,
      menu_items: items,
      rendered_items: renderedItems,
    });
  }
  return renderedMenus;
}

export function renderThemeTemplate(template: string, context: Record<string, unknown>) {
  const ctx = context as Record<string, unknown>;
  const system = buildThemeSystemContext(ctx);
  const payload: Record<string, unknown> = {
    ...system,
    system,
    ...context,
  };
  attachExcerptHelpersToPosts(payload);
  payload.theme = {
    ...asRecord(payload.theme),
    ...createThemeHelpers(payload),
  };

  const renderedMenus = renderThemeMenus(payload);
  if (Object.keys(renderedMenus).length > 0) {
    const currentTooty = asRecord(payload.tooty);
    payload.tooty = {
      ...currentTooty,
      renderedMenus,
    };
  }

  const headerRaw = typeof payload.theme_header === "string" ? payload.theme_header : "";
  const footerRaw = typeof payload.theme_footer === "string" ? payload.theme_footer : "";
  if (headerRaw) {
    payload.theme_header = env.renderString(headerRaw, payload);
  }
  if (footerRaw) {
    payload.theme_footer = env.renderString(footerRaw, payload);
  }

  return env.renderString(template, payload);
}
