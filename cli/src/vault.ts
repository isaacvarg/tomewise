import {
  InvalidLearningHomeError,
  loadLearningHome,
  rebuildVault,
  UnsupportedFormatVersionError,
  VaultDisabledError,
  type WrittenNotes,
} from "@tomewise/core";
import { findRoot, plural, USAGE, type Io } from "./main.ts";

export const VAULT_USAGE = "  tome vault rebuild";

export async function vault(io: Io, args: string[]): Promise<number> {
  if (args.length !== 1 || args[0] !== "rebuild") {
    io.stderr(USAGE);
    return 2;
  }
  const root = await findRoot(io);
  if (!root) return 2;

  let result: WrittenNotes;
  try {
    result = await rebuildVault(await loadLearningHome(root));
  } catch (error) {
    if (error instanceof VaultDisabledError) {
      io.stderr(error.message);
      return 2;
    }
    if (error instanceof InvalidLearningHomeError || error instanceof UnsupportedFormatVersionError) {
      io.stderr(error.message);
      return 1;
    }
    throw error;
  }
  io.stdout(`Wrote ${plural(result.written.length, "session note")}.`);
  for (const path of result.leftAlone) io.stdout(`Left ${path} alone: it has no generatedBy: tomewise marker.`);
  return 0;
}
