import { join } from "node:path";
import { JSON_SCHEMA_DIR, writeJsonSchemas } from "../src/json-schemas.ts";

const root = new URL("../../", import.meta.url).pathname;
const files = await writeJsonSchemas(join(root, JSON_SCHEMA_DIR));
console.log(`Wrote ${files.length} schemas to ${JSON_SCHEMA_DIR}`);
