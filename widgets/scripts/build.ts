import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

export const WIDGETS_OUT = fileURLToPath(new URL("../../app/widgets/", import.meta.url));
export const MAJOR = "v1";

export async function buildWidgets(out: string = WIDGETS_OUT): Promise<void> {
  const dir = join(out, MAJOR);
  await rm(dir, { recursive: true, force: true });
  const widgets = (await readdir(SRC)).filter((name) => /^tome-.+\.ts$/.test(name));
  await build({
    entryPoints: ["tome.ts", ...widgets].map((name) => join(SRC, name)),
    outdir: dir,
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify: true,
    chunkNames: "chunks/[name]-[hash]",
    logLevel: "warning",
  });
}

if (import.meta.main) await buildWidgets();
