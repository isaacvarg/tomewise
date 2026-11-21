import { cp, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "tomewise-test-"));
}

export async function writeFiles(root: string, files: Record<string, unknown>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, typeof content === "string" ? content : JSON.stringify(content, null, 2));
  }
}

export async function buildHome(files: Record<string, unknown>): Promise<string> {
  const root = await tempDir();
  await writeFiles(root, files);
  return root;
}

export async function copyExample(name: string): Promise<string> {
  const root = await tempDir();
  await cp(new URL(`../../examples/${name}/`, import.meta.url), root, { recursive: true });
  return root;
}

export async function snapshot(root: string): Promise<Record<string, string>> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files: Record<string, string> = {};
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const full = join(entry.parentPath, entry.name);
    files[full.slice(root.length + 1)] = await readFile(full, "utf8");
  }
  return files;
}
