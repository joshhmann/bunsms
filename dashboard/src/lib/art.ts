import { ASSET_BASE_URL, publishBuffers, resolveRevisionPath } from "@/lib/assets";

export function requireItemId(value: unknown): number {
  if ((typeof value !== "number" && typeof value !== "string") || !/^[0-9]+$/.test(String(value))) {
    throw new Error("itemId must be a positive integer");
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("itemId must be a positive integer");
  return id;
}

export function validateAnimationKeys(frames: unknown): asserts frames is Record<string, string[]> {
  if (!frames || typeof frames !== "object" || Array.isArray(frames)) throw new Error("frames must be an object");
  for (const [name, urls] of Object.entries(frames)) {
    if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error("Animation names must be single alphanumeric, underscore or hyphen segments");
    if (!Array.isArray(urls) || urls.some((url) => typeof url !== "string")) throw new Error(`Invalid frames for ${name}`);
  }
}

function pngBuffer(value: string): Buffer {
  return Buffer.from(value.replace(/^data:image\/png;base64,/, ""), "base64");
}

/** Publish an entire render together; no frame URL escapes before the commit. */
export async function publishRenderedArt(input: {
  itemId: number;
  icon?: string | null;
  origins: unknown;
  frames: Record<string, string[]>;
  concept?: { key: string; data: Buffer };
}) {
  const itemId = requireItemId(input.itemId);
  validateAnimationKeys(input.frames);
  const prefix = `custom-items/${itemId}`;
  const files: { key: string; data: Buffer }[] = [];
  if (input.icon) files.push({ key: `${prefix}/icon.png`, data: pngBuffer(input.icon) });
  for (const [name, frames] of Object.entries(input.frames)) {
    frames.forEach((data, i) => files.push({ key: `${prefix}/${name}/${i}.png`, data: pngBuffer(data) }));
  }
  files.push({ key: `${prefix}/origins.json`, data: Buffer.from(JSON.stringify(input.origins)) });
  if (input.concept) files.push(input.concept);
  const published = await publishBuffers(files);
  const urls = new Map(published.assets.map((asset) => [asset.key, asset.url]));
  const frames = Object.fromEntries(Object.entries(input.frames).map(([name, frames]) => [
    name, frames.map((_, i) => urls.get(`${prefix}/${name}/${i}.png`)!),
  ]));
  return {
    releaseId: published.releaseId,
    origins: input.origins,
    frames,
    iconUrl: input.icon ? urls.get(`${prefix}/icon.png`)! : null,
    conceptUrl: input.concept ? urls.get(input.concept.key)! : undefined,
    uploaded: files.length,
  };
}

/** Legacy records must be explicitly imported through the private migration route. */
export function resolveArtPath(value: string): string {
  const url = new URL(value, ASSET_BASE_URL);
  if (url.origin !== new URL(ASSET_BASE_URL).origin || url.search || url.hash) {
    throw new Error("Art reference requires explicit selfhost migration");
  }
  const match = /^\/client\/r\/([a-f0-9]{64})\/(.+)$/.exec(url.pathname);
  if (!match) throw new Error("Art reference requires explicit selfhost migration");
  const key = decodeURIComponent(match[2]);
  return resolveRevisionPath(key, match[1]);
}
