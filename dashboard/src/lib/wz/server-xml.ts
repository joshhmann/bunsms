// Server-side WZ XML browsing reads the verified committed server tar object.
// Extracted mirrors are private caches, never another publication authority.
//
// The server tarball contains XML mirrors of every .img the game server
// reads. Browsing it lets you confirm "did my published item make it into
// the server's view?" in addition to what the client sees.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "fs";
import { execFileSync } from "child_process";
import { join, relative, sep } from "path";
import { ASSET_DIR, readManifest, resolveRevisionPath } from "@/lib/assets";

import type {
  DirChild,
  DirListing,
  ImgResponse,
  PropNodeView,
  SearchMatch,
  SearchResult,
} from "./explorer";

const CACHE_ROOT = join(ASSET_DIR, "cache", "server-xml");
let WZ_ROOT = "";
let cachedHash = "";

/** Resolve one complete retained server overlay; publish a cache only after extraction. */
export async function ensureServerXml(): Promise<void> {
  const asset = readManifest().manifest.assets?.["server-wz.tar.gz"];
  if (!asset) throw new Error("No committed server-wz.tar.gz");
  if (cachedHash === asset.hash && existsSync(WZ_ROOT)) return;
  const destination = join(CACHE_ROOT, asset.hash);
  if (!existsSync(destination)) {
    mkdirSync(CACHE_ROOT, { recursive: true });
    const partial = mkdtempSync(join(CACHE_ROOT, `${asset.hash}.partial-`));
    try {
      execFileSync("tar", ["xzf", resolveRevisionPath(asset.key, asset.hash), "-C", partial, "--no-same-owner", "--no-same-permissions"], { timeout: 300000 });
      try { renameSync(partial, destination); }
      catch (error) { if (!existsSync(destination)) throw error; }
    } finally { rmSync(partial, { recursive: true, force: true }); }
  }
  WZ_ROOT = join(destination, "wz");
  if (!existsSync(WZ_ROOT)) throw new Error("Committed server tar has no wz directory");
  cachedHash = asset.hash;
}

// ---------- Tree listing ----------

/**
 * subPath is slash-separated relative to wz/ root, e.g.
 *   ""             → top-level Character.wz / Item.wz / ...
 *   "/Character.wz" → Hair / Face / ...
 *   "/Character.wz/Hair" → 00030000.img.xml ...
 */
export function getServerDirectoryListing(subPath: string): DirListing {
  const parts = subPath.split("/").filter(Boolean);
  const dir = join(WZ_ROOT, ...parts);
  if (!existsSync(dir)) {
    throw new Error(`Path not found: ${subPath}`);
  }
  const stat = statSync(dir);
  if (!stat.isDirectory()) {
    throw new Error(`${subPath} is not a directory`);
  }
  const entries = readdirSync(dir, { withFileTypes: true });
  const children: DirChild[] = entries
    .filter((e) => !e.name.startsWith("."))
    .map((e) => {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        const sub = readdirSync(full).filter((n) => !n.startsWith("."));
        return {
          name: e.name,
          type: "dir" as const,
          size: 0,
          childCount: sub.length,
        };
      }
      const sz = statSync(full).size;
      return { name: e.name, type: "img" as const, size: sz };
    })
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  return { path: subPath, children };
}

// ---------- XML → PropNodeView ----------

const TOKEN_RE = /<(\/?)(\w+)((?:\s+\w+="[^"]*")*)\s*(\/)?>/g;
const ATTR_RE = /(\w+)="([^"]*)"/g;

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_RE.exec(s))) {
    out[m[1]] = m[2]
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
  }
  return out;
}

function tagToProp(tag: string, attrs: Record<string, string>): PropNodeView {
  const name = attrs.name || "";
  switch (tag) {
    case "imgdir":
    case "extended":
      return { name, type: "sub", children: [] };
    case "int":
    case "short":
      return { name, type: "int", value: parseInt(attrs.value || "0", 10) };
    case "double":
    case "float":
      return {
        name,
        type: "int",
        value: parseFloat((attrs.value || "0").replace(",", ".")),
      };
    case "string":
    case "uol":
      return { name, type: "string", value: attrs.value || "" };
    case "canvas":
      return {
        name,
        type: "canvas",
        width: parseInt(attrs.width || "0", 10),
        height: parseInt(attrs.height || "0", 10),
        format: -1,
        formatSupported: false,
        decodeError: "Server XML has no pixel data — metadata only.",
      };
    case "vector":
      return {
        name,
        type: "vector",
        x: parseInt(attrs.x || "0", 10),
        y: parseInt(attrs.y || "0", 10),
      };
    default:
      return { name, type: "other", rawTypeName: tag };
  }
}

export function parseServerImgXmlString(xml: string, rootName: string): PropNodeView {
  const stack: PropNodeView[] = [];
  let root: PropNodeView | null = null;

  TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE.exec(xml))) {
    const [, slash, tag, attrsStr, selfClose] = m;
    if (slash) {
      stack.pop();
      continue;
    }
    if (tag === "xml") continue; // <?xml ...?> tokens won't match TOKEN_RE anyway, defensive
    const attrs = parseAttrs(attrsStr);
    const node = tagToProp(tag, attrs);
    if (stack.length === 0) {
      root = node;
    } else {
      const parent = stack[stack.length - 1];
      if (!parent.children) parent.children = [];
      parent.children.push(node);
    }
    if (!selfClose && (tag === "imgdir" || tag === "extended" || tag === "canvas")) {
      stack.push(node);
    }
  }

  if (!root) {
    return { name: rootName, type: "sub", children: [] };
  }
  // Use the .img name as the root display name for consistency with binary side.
  return { ...root, name: rootName };
}

export function getServerImgXml(subPath: string): ImgResponse {
  const parts = subPath.split("/").filter(Boolean);
  const filePath = join(WZ_ROOT, ...parts);
  if (!existsSync(filePath)) throw new Error(`Path not found: ${subPath}`);
  const stat = statSync(filePath);
  if (stat.isDirectory()) throw new Error(`${subPath} is a directory`);
  const xml = readFileSync(filePath, "utf-8");
  const baseName = parts[parts.length - 1];
  const tree = parseServerImgXmlString(xml, baseName);
  return {
    path: subPath,
    bytes: stat.size,
    tree,
  };
}

// ---------- Search ----------

export function searchServerXml(query: string, limit = 100): SearchResult {
  const q = query.toLowerCase();
  const matches: SearchMatch[] = [];
  let truncated = false;

  function walk(dir: string) {
    if (matches.length >= limit) {
      truncated = true;
      return;
    }
    let entries: import("fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      if (matches.length >= limit) {
        truncated = true;
        return;
      }
      const full = join(dir, e.name);
      const rel = "/" + relative(WZ_ROOT, full).split(sep).join("/");
      if (e.name.toLowerCase().includes(q)) {
        if (e.isDirectory()) {
          matches.push({ path: rel, kind: "dir" });
        } else {
          const sz = statSync(full).size;
          matches.push({ path: rel, kind: "img", size: sz });
        }
      }
      if (e.isDirectory()) walk(full);
    }
  }

  if (existsSync(WZ_ROOT)) walk(WZ_ROOT);
  return { query, matches, truncated };
}

// ---------- Helper: list top-level WZ subdirs (for the file dropdown) ----------

export function getServerWzTopLevel(): { name: string; size: number }[] {
  if (!existsSync(WZ_ROOT)) return [];
  return readdirSync(WZ_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => {
      // Approximate "size" as count of immediate children so the UI has
      // something to display alongside the name.
      try {
        const sub = readdirSync(join(WZ_ROOT, e.name));
        return { name: e.name, size: sub.length };
      } catch {
        return { name: e.name, size: 0 };
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
