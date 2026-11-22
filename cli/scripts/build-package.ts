import { chmod, cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { buildWidgets } from "../../widgets/scripts/build.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));

export interface BuildOptions {
  out: string;
  spa?: string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function buildPackage({ out, spa }: BuildOptions): Promise<void> {
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  const bin = join(out, "lib/tome.js");
  await build({
    entryPoints: [join(REPO, "cli/src/main.ts")],
    outfile: bin,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    logLevel: "warning",
  });
  await chmod(bin, 0o755);

  await buildWidgets(join(out, "widgets"));
  await cp(join(REPO, "app/themes"), join(out, "themes"), { recursive: true });
  if (spa !== undefined) await cp(spa, join(out, "dist"), { recursive: true });

  const cli = JSON.parse(await readFile(join(REPO, "cli/package.json"), "utf8"));
  const root = JSON.parse(await readFile(join(REPO, "package.json"), "utf8"));
  const manifest = {
    name: "tomewise",
    version: cli.version,
    description: "Self-hosted learning app: an AI agent writes the course, the app runs it and remembers your practice.",
    license: "MIT",
    type: "module",
    bin: { tomewise: "lib/tome.js", tome: "lib/tome.js" },
    engines: root.engines,
  };
  await writeFile(join(out, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await cp(join(REPO, "LICENSE"), join(out, "LICENSE"));
  await cp(join(REPO, "docs/deployment.md"), join(out, "README.md"));
}

if (import.meta.main) {
  const spa = join(REPO, "app/dist");
  await buildPackage({ out: join(REPO, "build/tomewise"), spa: (await exists(spa)) ? spa : undefined });
}
