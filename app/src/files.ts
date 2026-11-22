import { readFile, realpath, stat } from "node:fs/promises";
import { extname, join, sep } from "node:path";
import type { Context } from "hono";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/opus",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".pdf": "application/pdf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
};

const NOT_FOUND = new Set(["ENOENT", "ENOTDIR", "ELOOP", "ENAMETOOLONG"]);

export function contentTypeOf(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

export function isSafeSegment(segment: string): boolean {
  return segment !== "" && segment !== "." && segment !== ".." && !/[\\/\0]/.test(segment);
}

function swallowMissing(error: unknown): undefined {
  if (NOT_FOUND.has((error as NodeJS.ErrnoException).code ?? "")) return undefined;
  throw error;
}

export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    return swallowMissing(error) ?? false;
  }
}

export async function resolveUnder(base: string, path: string): Promise<string | undefined> {
  const segments = path.split("/");
  if (!segments.every(isSafeSegment)) return undefined;
  try {
    const [realBase, realFile] = await Promise.all([realpath(base), realpath(join(base, ...segments))]);
    if (!realFile.startsWith(realBase + sep)) return undefined;
    if (!(await stat(realFile)).isFile()) return undefined;
    return realFile;
  } catch (error) {
    return swallowMissing(error);
  }
}

export async function sendFile(c: Context, file: string | undefined) {
  if (!file) return c.notFound();
  return c.body(new Uint8Array(await readFile(file)), 200, { "content-type": contentTypeOf(file) });
}
