import { readFile } from "node:fs/promises";

export type JsonRead = { ok: true; value: unknown } | { ok: false; missing: boolean; message: string };

export async function readJson(path: string): Promise<JsonRead> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT"
      ? { ok: false, missing: true, message: "File not found" }
      : { ok: false, missing: false, message: `Cannot read file (${code})` };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, missing: false, message: `Invalid JSON: ${(error as Error).message}` };
  }
}
