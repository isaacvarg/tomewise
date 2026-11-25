import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const REGISTRY_LATEST = "https://registry.npmjs.org/tomewise/latest";
export const IMAGE = "ghcr.io/isaacvarg/tomewise";
export const UPDATE_CHECK_MS = 24 * 60 * 60 * 1000;

export type Install = "npm" | "docker";

export interface Update {
  current: string;
  latest: string;
  install: Install;
  command: string;
  then: string;
}

export interface UpdateCheckOptions {
  current: string;
  env: NodeJS.ProcessEnv;
  now?: () => Date;
  cacheFile?: string;
  maxAgeMs?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

interface Cached {
  checkedAt: string;
  latest: string;
}

function parse(version: string): number[] | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  return match ? match.slice(1).map(Number) : undefined;
}

export function isNewer(latest: string, current: string): boolean {
  const [a, b] = [parse(latest), parse(current)];
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return false;
}

export function installOf(env: NodeJS.ProcessEnv): Install {
  return env.TOMEWISE_INSTALL === "docker" ? "docker" : "npm";
}

export function updateChecksOff(env: NodeJS.ProcessEnv): boolean {
  const off = env.TOMEWISE_NO_UPDATE_CHECK;
  return (off !== undefined && off !== "" && off !== "0") || (env.CI !== undefined && env.CI !== "" && env.CI !== "false");
}

export function updateFor(current: string, latest: string, install: Install): Update {
  if (install === "docker") {
    const tag = latest.split(".").slice(0, 2).join(".");
    return { current, latest, install, command: `docker pull ${IMAGE}:${tag}`, then: `recreate the container from ${IMAGE}:${tag}` };
  }
  return { current, latest, install, command: "npm install -g tomewise@latest", then: "restart the app" };
}

export function updateNotice(update: Update): string {
  return `Tomewise ${update.latest} is out (you have ${update.current}). Update: ${update.command}, then ${update.then}.`;
}

export function updateCachePath(env: NodeJS.ProcessEnv): string | undefined {
  return env.HOME ? join(env.HOME, ".config", "tomewise", "update-check.json") : undefined;
}

async function readCache(file: string | undefined): Promise<Cached | undefined> {
  if (!file) return undefined;
  try {
    const cached = JSON.parse(await readFile(file, "utf8"));
    if (typeof cached?.checkedAt === "string" && typeof cached?.latest === "string") return cached;
  } catch {}
  return undefined;
}

async function writeCache(file: string | undefined, cached: Cached): Promise<void> {
  if (!file) return;
  try {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(cached)}\n`);
  } catch {}
}

export async function fetchLatest(fetchFn: typeof fetch = fetch, timeoutMs = 3000): Promise<string | undefined> {
  try {
    const response = await fetchFn(REGISTRY_LATEST, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return undefined;
    const version = (await response.json())?.version;
    return typeof version === "string" && parse(version) ? version : undefined;
  } catch {
    return undefined;
  }
}

export async function checkForUpdate({
  current,
  env,
  now = () => new Date(),
  cacheFile,
  maxAgeMs = UPDATE_CHECK_MS,
  timeoutMs,
  fetch: fetchFn,
}: UpdateCheckOptions): Promise<Update | null> {
  if (updateChecksOff(env)) return null;
  const cached = await readCache(cacheFile);
  let latest = cached?.latest;
  const age = cached ? now().getTime() - Date.parse(cached.checkedAt) : Infinity;
  if (!(age >= 0 && age < maxAgeMs)) {
    latest = (await fetchLatest(fetchFn, timeoutMs)) ?? latest;
    await writeCache(cacheFile, { checkedAt: now().toISOString(), latest: latest ?? current });
  }
  return latest !== undefined && isNewer(latest, current) ? updateFor(current, latest, installOf(env)) : null;
}
