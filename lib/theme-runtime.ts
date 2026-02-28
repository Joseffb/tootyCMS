import { access, readFile } from "fs/promises";
import path from "path";
import { getSiteThemeId, listThemesWithState, type ThemeWithState } from "@/lib/themes";
import { getThemesDirs } from "@/lib/extension-paths";
import {
  domainArchiveTemplateCandidates,
  domainDetailTemplateCandidates,
  homeTemplateCandidates,
  taxonomyArchiveTemplateCandidates,
} from "@/lib/theme-fallback";
import type { ThemeQueryRequest } from "@/lib/theme-query";
import { resolveThemeQueryRequests } from "@/lib/theme-query-contract";
import { getPluginById } from "@/lib/plugins";
import { getPluginOwnerForDataDomain } from "@/lib/plugin-content-types";
import { pluralizeLabel } from "@/lib/data-domain-labels";

function isExternal(url: string) {
  return url.startsWith("http://") || url.startsWith("https://") || url.startsWith("/");
}

function toThemeAssetUrl(themeId: string, asset: string) {
  if (isExternal(asset)) return asset;
  const clean = asset.replace(/^\/+/, "").replace(/^assets\//, "");
  return `/theme-assets/${themeId}/${clean}`;
}

async function exists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadThemePartials(themeRoot: string) {
  const partials: { header: string; footer: string; commentItem: string; password: string; comments: string } = {
    header: "",
    footer: "",
    commentItem: "",
    password: "",
    comments: "",
  };
  for (const partialName of ["header.html", "footer.html", "comment-item.html", "password.html", "comments.html"] as const) {
    const partialPath = path.join(themeRoot, "templates", partialName);
    try {
      const partialRaw = await readFile(partialPath, "utf8");
      if (partialName === "header.html") partials.header = partialRaw;
      if (partialName === "footer.html") partials.footer = partialRaw;
      if (partialName === "comment-item.html") partials.commentItem = partialRaw;
      if (partialName === "password.html") partials.password = partialRaw;
      if (partialName === "comments.html") partials.comments = partialRaw;
    } catch {
      // optional partial
    }
  }
  return partials;
}

async function readFirstExistingTemplate(baseDir: string, candidates: string[]) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const safeFile = candidate.replace(/^\/+/, "");
    const templatePath = path.join(baseDir, "templates", safeFile);
    try {
      const raw = await readFile(templatePath, "utf8");
      return raw;
    } catch {
      continue;
    }
  }
  return null;
}

async function readPluginFallbackTemplate(dataDomain: string, candidates: string[]) {
  const pluginId = await getPluginOwnerForDataDomain(dataDomain);
  if (!pluginId) return null;
  const plugin = await getPluginById(pluginId);
  if (!plugin) return null;
  const pluginSourceDir = String((plugin as any).sourceDir || path.join(process.cwd(), "plugins"));
  const pluginRoot = path.join(pluginSourceDir, plugin.id);
  const raw = await readFirstExistingTemplate(pluginRoot, candidates);
  if (!raw) return null;
  return raw;
}

function getThemeBaseDir(active: ThemeWithState) {
  return active.sourceDir || getThemesDirs()[0] || path.join(process.cwd(), "themes");
}

export async function getActiveThemeForSite(siteId: string): Promise<ThemeWithState | null> {
  const [themes, selectedId] = await Promise.all([listThemesWithState(), getSiteThemeId(siteId)]);
  if (!themes.length) return null;
  const enabledThemes = themes.filter((theme) => theme.enabled);
  return enabledThemes.find((theme) => theme.id === selectedId) || enabledThemes[0] || themes[0] || null;
}

export async function getThemeAssetsForSite(siteId: string) {
  const active = await getActiveThemeForSite(siteId);
  if (!active) return { styles: [], scripts: [] };
  const themesDir = getThemeBaseDir(active);

  const manifestAssets = (active as any).assets || {};
  const styles = Array.isArray(manifestAssets.styles)
    ? manifestAssets.styles.map((asset: string) => toThemeAssetUrl(active.id, asset))
    : [];
  const scripts = Array.isArray(manifestAssets.scripts)
    ? manifestAssets.scripts.map((asset: string) => toThemeAssetUrl(active.id, asset))
    : [];

  const defaultStylePath = path.join(themesDir, active.id, "assets", "style.css");
  const defaultScriptPath = path.join(themesDir, active.id, "assets", "theme.js");

  if (styles.length === 0 && (await exists(defaultStylePath))) {
    styles.push(`/theme-assets/${active.id}/style.css`);
  }

  if (scripts.length === 0 && (await exists(defaultScriptPath))) {
    scripts.push(`/theme-assets/${active.id}/theme.js`);
  }

  return { styles, scripts };
}

export async function getThemeTemplateForSite(siteId: string) {
  const active = await getActiveThemeForSite(siteId);
  if (!active) return null;
  const themesDir = getThemeBaseDir(active);

  const manifestTemplates = (active as any).templates || {};
  const configured = typeof manifestTemplates.home === "string" ? manifestTemplates.home : "";
  const candidates = homeTemplateCandidates(configured);

  const themeRoot = path.join(themesDir, active.id);
  const raw = await readFirstExistingTemplate(themeRoot, candidates);
  if (raw) {
    const partials = await loadThemePartials(themeRoot);
    return {
      template: raw,
      themeId: active.id,
      config: active.config || {},
      themeName: active.name,
      partials,
    };
  }

  return null;
}

export async function getThemeQueryRequestsForSite(siteId: string, routeKind: string): Promise<ThemeQueryRequest[]> {
  const active = await getActiveThemeForSite(siteId);
  return resolveThemeQueryRequests(active, routeKind);
}

export async function getThemeTemplateFromCandidates(
  siteId: string,
  candidates: string[],
  opts?: { pluginDataDomain?: string; pluginCandidates?: string[] },
) {
  const active = await getActiveThemeForSite(siteId);
  if (!active) return null;
  const themesDir = getThemeBaseDir(active);
  const themeRoot = path.join(themesDir, active.id);
  const partials = await loadThemePartials(themeRoot);
  const raw = await readFirstExistingTemplate(themeRoot, candidates);
  if (raw) {
    return {
      template: raw,
      themeId: active.id,
      config: active.config || {},
      themeName: active.name,
      partials,
    };
  }

  const pluginDataDomain = String(opts?.pluginDataDomain || "").trim().toLowerCase();
  const pluginCandidates = Array.isArray(opts?.pluginCandidates) ? opts?.pluginCandidates : [];
  if (pluginDataDomain && pluginCandidates.length > 0) {
    const pluginTemplate = await readPluginFallbackTemplate(pluginDataDomain, pluginCandidates);
    if (pluginTemplate) {
      return {
        template: pluginTemplate,
        themeId: active.id,
        config: active.config || {},
        themeName: active.name,
        partials,
      };
    }
  }
  return null;
}

export async function getThemeTemplateByHierarchy(
  siteId: string,
  opts: { taxonomy: "category" | "tag"; slug: string; dataDomain?: string },
) {
  const slug = opts.slug.trim().toLowerCase();
  const dataDomain = (opts.dataDomain || "").trim().toLowerCase();
  const taxonomy = opts.taxonomy;
  const taxonomyCandidates = taxonomyArchiveTemplateCandidates(taxonomy, slug);
  const domainArchiveCandidates = dataDomain ? domainArchiveTemplateCandidates(dataDomain, "") : [];
  const domainCandidates = dataDomain
    ? taxonomy === "category"
      ? [`${dataDomain}-category-${slug}.html`]
      : [`${dataDomain}-tag-${slug}.html`]
    : [];
  const candidates = [...domainCandidates, ...taxonomyCandidates, ...domainArchiveCandidates];

  const pluginCandidates = dataDomain
    ? [`archive-${pluralizeLabel(dataDomain).trim().toLowerCase()}.html`, `archive-${dataDomain}.html`]
    : [];
  return getThemeTemplateFromCandidates(siteId, candidates, {
    pluginDataDomain: dataDomain,
    pluginCandidates,
  });
}

export async function getThemeDetailTemplateByHierarchy(
  siteId: string,
  opts: { dataDomain: string; slug: string },
) {
  const dataDomain = opts.dataDomain.trim().toLowerCase();
  const slug = opts.slug.trim().toLowerCase();
  const candidates = domainDetailTemplateCandidates(dataDomain, slug);
  const pluginOwner = await getPluginOwnerForDataDomain(dataDomain);
  const specificCandidates = candidates.filter((candidate) => candidate !== "single.html" && candidate !== "index.html");
  if (pluginOwner) {
    return getThemeTemplateFromCandidates(siteId, specificCandidates, {
      pluginDataDomain: dataDomain,
      pluginCandidates: [
        `single-${pluralizeLabel(dataDomain).trim().toLowerCase()}.html`,
        `single-${dataDomain}.html`,
      ],
    });
  }
  return getThemeTemplateFromCandidates(siteId, candidates, {
    pluginDataDomain: dataDomain,
    pluginCandidates: [
      `single-${pluralizeLabel(dataDomain).trim().toLowerCase()}.html`,
      `single-${dataDomain}.html`,
    ],
  });
}

export async function getThemeLayoutTemplateForSite(
  siteId: string,
  opts: { layout: string; dataDomain?: string },
) {
  const layout = opts.layout.trim().toLowerCase();
  if (!layout) return null;

  const dataDomain = (opts.dataDomain || "").trim().toLowerCase();
  const candidates = [
    dataDomain ? `${dataDomain}-${layout}.html` : "",
    dataDomain ? `${dataDomain}_${layout}.html` : "",
    `layout-${layout}.html`,
    `${layout}.html`,
  ].filter(Boolean);

  return getThemeTemplateFromCandidates(siteId, candidates);
}
