import {
  GENERATED_MARKER,
  InvalidLearningHomeError,
  loadLearningHome,
  rebuildVault,
  UnsupportedFormatVersionError,
  VaultDisabledError,
  type VaultRebuild,
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

  let result: VaultRebuild;
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
  io.stdout(`Wrote ${plural(result.written.length, "vault file")}.`);
  io.stdout(`Wrote ${plural(result.curricula.written.length, "curriculum copy", "curriculum copies")}.`);
  for (const path of [...result.leftAlone, ...result.curricula.leftAlone]) {
    io.stdout(`Left ${path} alone: it has no ${GENERATED_MARKER} marker.`);
  }
  return 0;
}
