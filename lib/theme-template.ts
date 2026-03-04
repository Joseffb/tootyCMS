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
