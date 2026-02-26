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

  for (const candidate of candidates) {
    if (!candidate) continue;
    const safeFile = candidate.replace(/^\/+/, "");
    const templatePath = path.join(themesDir, active.id, "templates", safeFile);
    try {
      const raw = await readFile(templatePath, "utf8");
      const partials: { header: string; footer: string } = { header: "", footer: "" };
      for (const partialName of ["header.html", "footer.html"] as const) {
        const partialPath = path.join(themesDir, active.id, "templates", partialName);
        try {
          const partialRaw = await readFile(partialPath, "utf8");
          if (partialName === "header.html") partials.header = partialRaw;
          if (partialName === "footer.html") partials.footer = partialRaw;
        } catch {
          // optional partial
        }
      }

      return {
        template: raw,
        themeId: active.id,
        config: active.config || {},
        themeName: active.name,
        partials,
      };
    } catch {
      continue;
    }
  }

  return null;
}

export async function getThemeQueryRequestsForSite(siteId: string, routeKind: string): Promise<ThemeQueryRequest[]> {
  const active = await getActiveThemeForSite(siteId);
  return resolveThemeQueryRequests(active, routeKind);
}

export async function getThemeTemplateFromCandidates(siteId: string, candidates: string[]) {
  const active = await getActiveThemeForSite(siteId);
  if (!active) return null;
  const themesDir = getThemeBaseDir(active);

  for (const candidate of candidates) {
    if (!candidate) continue;
    const safeFile = candidate.replace(/^\/+/, "");
    const templatePath = path.join(themesDir, active.id, "templates", safeFile);
    try {
      const raw = await readFile(templatePath, "utf8");
      const partials: { header: string; footer: string } = { header: "", footer: "" };
      for (const partialName of ["header.html", "footer.html"] as const) {
        const partialPath = path.join(themesDir, active.id, "templates", partialName);
        try {
          const partialRaw = await readFile(partialPath, "utf8");
          if (partialName === "header.html") partials.header = partialRaw;
          if (partialName === "footer.html") partials.footer = partialRaw;
        } catch {
          // optional partial
        }
      }

      return {
        template: raw,
        themeId: active.id,
        config: active.config || {},
        themeName: active.name,
        partials,
      };
    } catch {
      continue;
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

  return getThemeTemplateFromCandidates(siteId, candidates);
}

export async function getThemeDetailTemplateByHierarchy(
  siteId: string,
  opts: { dataDomain: string; slug: string },
) {
  const dataDomain = opts.dataDomain.trim().toLowerCase();
  const slug = opts.slug.trim().toLowerCase();
  const candidates = domainDetailTemplateCandidates(dataDomain, slug);
  return getThemeTemplateFromCandidates(siteId, candidates);
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
