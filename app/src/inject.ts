export const TOME_JS = "/widgets/v1/tome.js";

export type PageKind = "lesson" | "quiz" | "exam";

export interface Injection {
  themeCss?: string;
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

export function injectPage(html: string, { themeCss, subject, kind, id }: Injection): string {
  const tags = [
    `<meta name="tome-subject" content="${escapeAttribute(subject)}">`,
    `<meta name="tome-page-kind" content="${kind}">`,
    `<meta name="tome-${kind}" content="${escapeAttribute(id)}">`,
  ];
  if (themeCss && !references(html, "href", themeCss)) tags.push(`<link rel="stylesheet" href="${themeCss}">`);
  if (!references(html, "src", TOME_JS)) tags.push(`<script type="module" src="${TOME_JS}"></script>`);
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
