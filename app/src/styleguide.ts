import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { type LearningHome, loadLearningHome, loadSubject, type Subject } from "@tomewise/core";
import { resolveUnder, sendFile } from "./files.ts";
import { injectPage } from "./inject.ts";
import { entryAssets } from "./spa.ts";
import type { ResolveTheme } from "./themes.ts";

export const STYLEGUIDE = fileURLToPath(new URL("../styleguide/", import.meta.url));
const DEMO_SUBJECT = "demo";
const MODES = new Set(["light", "dark"]);

function jsonScript(id: string, value: unknown): string {
  return `<script type="application/json" id="${id}">${JSON.stringify(value).replace(/</g, "\\u003c")}</script>`;
}

const APP_ENTRY = "styleguide.tsx";

async function appTags(spa: string | undefined): Promise<string> {
  const assets = spa === undefined ? undefined : await entryAssets(spa, APP_ENTRY);
  if (!assets) return "";
  const styles = assets.styles.map((href) => `<link rel="stylesheet" href="${href}">`);
  return [...styles, `<script type="module" src="${assets.script}" data-styleguide-app></script>`].join("\n") + "\n";
}

export interface StyleguideOptions {
  dir?: string;
  spa?: string;
}

export function styleguideRoutes(
  home: () => LearningHome,
  resolveTheme: ResolveTheme,
  { dir = STYLEGUIDE, spa }: StyleguideOptions = {},
): Hono {
  const routes = new Hono();
  let demo: Promise<Subject> | undefined;
  const demoSubject = () => {
    demo ??= loadLearningHome(`${dir}home`).then((demoHome) => loadSubject(demoHome, DEMO_SUBJECT));
    demo.catch(() => (demo = undefined));
    return demo;
  };

  routes.get("/", async (c) => {
    const requested = c.req.query("theme") || undefined;
    const mode = c.req.query("mode");
    const [template, subject, theme, app] = await Promise.all([
      readFile(`${dir}page.html`, "utf8"),
      demoSubject(),
      resolveTheme(home(), requested),
      appTags(spa),
    ]);
    const page = MODES.has(mode ?? "") ? template.replace(/<html\b/i, `<html data-mode="${mode}"`) : template;
    const html = injectPage(page, theme, { subject: DEMO_SUBJECT, kind: "lesson", id: "styleguide" })
      .replace(/<head\b[^>]*>/i, (open) => `${open}\n${jsonScript("styleguide-data", { subject, themeName: theme?.name ?? "" })}`)
      .replace(/<\/head\s*>/i, (close) => `${app}${close}`);
    return c.html(html);
  });

  routes.get("/:file{[\\w.-]+\\.(?:js|css)}", async (c) => sendFile(c, await resolveUnder(dir, c.req.param("file"))));

  return routes;
}
