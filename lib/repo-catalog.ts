import { mkdir, readdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";
import { getPluginsDir, getThemesDir } from "@/lib/extension-paths";

type CatalogKind = "plugin" | "theme";

type GithubContentItem = {
  name: string;
  path: string;
  type: "file" | "dir";
  download_url: string | null;
  content?: string;
  encoding?: string;
};

type CatalogRepo = {
  owner: string;
  repo: string;
  branch: string;
};

function parseRepoSlug(raw: string | undefined, fallbackOwner: string, fallbackRepo: string) {
  const slug = String(raw || "").trim();
  if (!slug) return { owner: fallbackOwner, repo: fallbackRepo };
  const [owner, repo] = slug.split("/");
  if (!owner || !repo) return { owner: fallbackOwner, repo: fallbackRepo };
  return { owner, repo };
}

export type CatalogEntry = {
  id: string;
  name: string;
  description: string;
  version: string;
  directory: string;
};

const pluginRepo = parseRepoSlug(
  process.env.TOOTY_PLUGIN_REPO,
  process.env.TOOTY_PLUGIN_REPO_OWNER || "Joseffb",
  process.env.TOOTY_PLUGIN_REPO_NAME || "tootyCMS-plugins",
);
const themeRepo = parseRepoSlug(
  process.env.TOOTY_THEME_REPO,
  process.env.TOOTY_THEME_REPO_OWNER || "Joseffb",
  process.env.TOOTY_THEME_REPO_NAME || "tootyCMS-themes",
);

const DEFAULT_REPOS: Record<CatalogKind, CatalogRepo> = {
  plugin: {
    owner: pluginRepo.owner,
    repo: pluginRepo.repo,
    branch: process.env.TOOTY_PLUGIN_REPO_BRANCH || "main",
  },
  theme: {
    owner: themeRepo.owner,
    repo: themeRepo.repo,
    branch: process.env.TOOTY_THEME_REPO_BRANCH || "main",
  },
};

function manifestName(kind: CatalogKind) {
  return kind === "plugin" ? "plugin.json" : "theme.json";
}

function destinationDir(kind: CatalogKind) {
  return kind === "plugin" ? getPluginsDir() : getThemesDir();
}

function githubApiUrl(repo: CatalogRepo, contentPath: string) {
  const encodedPath = contentPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `https://api.github.com/repos/${repo.owner}/${repo.repo}/contents/${encodedPath}?ref=${encodeURIComponent(repo.branch)}`;
}

function githubHeaders() {
  const token = process.env.TOOTY_GITHUB_TOKEN || process.env.GITHUB_TOKEN || "";
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "tooty-cms",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function fetchGithubJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: githubHeaders(),
    cache: "no-store",
  });
  if (!res.ok) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    const reset = res.headers.get("x-ratelimit-reset");
    if (res.status === 403) {
      throw new Error(`GITHUB_RATE_LIMIT:${reset ?? ""}:${remaining ?? ""}`);
    }
    throw new Error(`GitHub API request failed (${res.status}) for ${url}.`);
  }
  return (await res.json()) as T;
}

async function fetchGithubBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url, {
    headers: githubHeaders(),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Failed downloading file (${res.status})`);
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

function parseManifest(raw: string, fallbackId: string) {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      id: String(parsed.id || fallbackId),
      name: String(parsed.name || fallbackId),
      description: String(parsed.description || ""),
      version: String(parsed.version || ""),
    };
  } catch {
    return null;
  }
}

export async function listLocalInstalledIds(kind: CatalogKind) {
  const dir = destinationDir(kind);
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return new Set(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name));
  } catch {
    return new Set<string>();
  }
}

export async function listRepoCatalog(kind: CatalogKind, query = ""): Promise<CatalogEntry[]> {
  const repo = DEFAULT_REPOS[kind];
  const rootContents = await fetchGithubJson<GithubContentItem[]>(githubApiUrl(repo, ""));
  const directories = (Array.isArray(rootContents) ? rootContents : [])
    .filter((item) => item.type === "dir")
    .map((item) => item.name)
    .filter((name) => !name.startsWith("."));

  const entries: CatalogEntry[] = [];
  const manifestFile = manifestName(kind);
  for (const directory of directories) {
    try {
      const manifestObj = await fetchGithubJson<GithubContentItem>(
        githubApiUrl(repo, `${directory}/${manifestFile}`),
      );
      let raw = "";
      if (manifestObj.content && manifestObj.encoding === "base64") {
        raw = Buffer.from(manifestObj.content, "base64").toString("utf8");
      } else if (manifestObj.download_url) {
        raw = Buffer.from(await fetchGithubBytes(manifestObj.download_url)).toString("utf8");
      } else {
        continue;
      }
      const manifest = parseManifest(raw, directory);
      if (!manifest) continue;
      entries.push({
        id: manifest.id,
        name: manifest.name,
        description: manifest.description,
        version: manifest.version,
        directory,
      });
    } catch {
      // skip non-manifest folders
    }
  }

  const normalized = query.trim().toLowerCase();
  const filtered = normalized
    ? entries.filter((entry) =>
        [entry.id, entry.name, entry.description].some((part) => part.toLowerCase().includes(normalized)),
      )
    : entries;

  return filtered.sort((a, b) => a.name.localeCompare(b.name));
}

async function downloadDirectoryRecursive(repo: CatalogRepo, sourcePath: string, destPath: string): Promise<void> {
  await mkdir(destPath, { recursive: true });
  const contents = await fetchGithubJson<GithubContentItem[]>(githubApiUrl(repo, sourcePath));
  for (const item of contents) {
    if (item.type === "dir") {
      await downloadDirectoryRecursive(repo, item.path, path.join(destPath, item.name));
      continue;
    }
    const targetFile = path.join(destPath, item.name);
    if (item.download_url) {
      const bytes = await fetchGithubBytes(item.download_url);
      await writeFile(targetFile, bytes);
      continue;
    }
    const fileObj = await fetchGithubJson<GithubContentItem>(githubApiUrl(repo, item.path));
    if (fileObj.content && fileObj.encoding === "base64") {
      const bytes = Buffer.from(fileObj.content, "base64");
      await writeFile(targetFile, bytes);
    }
  }
}

export async function installFromRepo(kind: CatalogKind, directory: string) {
  const repo = DEFAULT_REPOS[kind];
  const root = destinationDir(kind);
  const targetDir = path.join(root, directory);
  await rm(targetDir, { recursive: true, force: true });
  await downloadDirectoryRecursive(repo, directory, targetDir);
}

export function toRepoCatalogFriendlyError(rawError: string, errorCode?: string) {
  const code = (errorCode || "").trim();
  const raw = (rawError || "").trim();
  if (code === "rate_limit") {
    return "Please slow down. GitHub has rate limiting. Try again in a few minutes.";
  }

  if (raw.startsWith("GITHUB_RATE_LIMIT:")) {
    const [, resetRaw] = raw.split(":");
    const resetEpoch = Number(resetRaw || "");
    if (Number.isFinite(resetEpoch) && resetEpoch > 0) {
      const msUntilReset = Math.max(0, resetEpoch * 1000 - Date.now());
      const minutes = Math.max(1, Math.ceil(msUntilReset / 60000));
      return `Please slow down. GitHub has rate limiting. Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`;
    }
    return "Please slow down. GitHub has rate limiting. Try again in a few minutes.";
  }

  return raw;
}

export async function readLocalManifest(kind: CatalogKind, directory: string): Promise<CatalogEntry | null> {
  const file = path.join(destinationDir(kind), directory, manifestName(kind));
  try {
    const raw = await readFile(file, "utf8");
    const manifest = parseManifest(raw, directory);
    if (!manifest) return null;
    return {
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      version: manifest.version,
      directory,
    };
  } catch {
    return null;
  }
}
