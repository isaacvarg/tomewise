import type { Theme } from "./themes.ts";

export const TOME_JS = "/widgets/v1/tome.js";
export const BASE_CSS = "/widgets/v1/base.css";
export const LAYER_ORDER = "@layer tome.reset, tome.base, tome.widgets, theme;";

export type PageKind = "lesson" | "quiz" | "exam";

export interface PageContext {
  subject: string;
  kind: PageKind;
  id: string;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function references(html: string, attribute: "src" | "href", url: string): boolean {
  return new RegExp(`\\b${attribute}\\s*=\\s*["']?${escapeRegExp(url)}(?=["'\\s>])`, "i").test(html);
}

function themeTags(html: string, theme: Theme | undefined): string[] {
  const imports = [LAYER_ORDER];
  if (!references(html, "href", BASE_CSS)) imports.push(`@import url("${BASE_CSS}");`);
  if (theme) {
    const files = ["tokens.css", ...(theme.themeCss ? ["theme.css"] : [])].map((file) => `/themes/${theme.name}/${file}`);
    for (const url of files) if (!references(html, "href", url)) imports.push(`@import url("${url}") layer(theme);`);
  }
  const tags = [`<style>\n${imports.join("\n")}\n</style>`];
  if (theme) tags.unshift(`<meta name="tome-theme" content="${escapeAttribute(theme.name)}">`);
  if (theme?.script) {
    const src = `/themes/${theme.name}/${theme.script}`;
    if (!references(html, "src", src)) tags.push(`<script type="module" src="${escapeAttribute(src)}"></script>`);
  }
  return tags;
}

export function injectTheme(html: string, theme: Theme | undefined): string {
  return injectHead(html, themeTags(html, theme));
}

export function injectPage(html: string, theme: Theme | undefined, { subject, kind, id }: PageContext): string {
  const tags = [
    `<meta name="tome-subject" content="${escapeAttribute(subject)}">`,
    `<meta name="tome-page-kind" content="${kind}">`,
    `<meta name="tome-${kind}" content="${escapeAttribute(id)}">`,
    ...themeTags(html, theme),
  ];
  if (!references(html, "src", TOME_JS)) tags.push(`<script type="module" src="${TOME_JS}"></script>`);
  return injectHead(html, tags);
}

function injectHead(html: string, tags: string[]): string {
  const block = tags.join("\n") + "\n";
  const close = html.search(/<\/head\s*>/i);
  if (close !== -1) return html.slice(0, close) + block + html.slice(close);
  const open = /<head\b[^>]*>/i.exec(html);
  if (open) return insertAfter(html, open, "\n" + block);
  const root = /<html\b[^>]*>/i.exec(html) ?? /<!doctype[^>]*>/i.exec(html);
  const head = `<head>\n${block}</head>\n`;
  return root ? insertAfter(html, root, "\n" + head) : head + html;
}

function insertAfter(html: string, match: RegExpExecArray, text: string): string {
  const end = match.index + match[0].length;
  return html.slice(0, end) + text + html.slice(end);
}
