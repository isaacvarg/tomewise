import { readConfig } from "./config.ts";
import { InvalidLearningHomeError, UnsupportedFormatVersionError } from "./errors.ts";
import type { TomewiseConfig } from "./schemas.ts";

export interface LearningHome {
  root: string;
  config: TomewiseConfig;
}

export async function loadLearningHome(root: string): Promise<LearningHome> {
  const read = await readConfig(root);
  switch (read.kind) {
    case "ok":
      return { root, config: read.config };
    case "too-new":
      throw new UnsupportedFormatVersionError(read.issue.message);
    case "invalid":
      throw new InvalidLearningHomeError(read.issues);
  }
}
