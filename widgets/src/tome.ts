import { tome } from "./api.ts";
import { loadWidgets } from "./loader.ts";

export { readPageContext, Tome, tome, TomeError } from "./api.ts";
export type { AttemptInput, Grade, Issue, Outcome, PageContext, PageKind } from "./api.ts";

tome.watch();
loadWidgets(document);
