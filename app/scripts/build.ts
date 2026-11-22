import { fileURLToPath } from "node:url";
import { build } from "vite";
import { BUILT_SPA } from "../src/spa.ts";

const CONFIG = fileURLToPath(new URL("../vite.config.ts", import.meta.url));

export async function buildSpa(out: string = BUILT_SPA): Promise<void> {
  await build({ configFile: CONFIG, logLevel: "warn", build: { outDir: out, emptyOutDir: true } });
}

if (import.meta.main) await buildSpa();
