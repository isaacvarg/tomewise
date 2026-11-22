import type { ThemeChoice } from "../api.ts";

const THEME_IMPORT = /^@import url\("\/themes\/[^"]*"\) layer\(theme\);$/;
const loadedTheme = document.querySelector<HTMLMetaElement>('meta[name="tome-theme"]')?.content;

function themeStyle(): HTMLStyleElement | undefined {
  return [...document.head.querySelectorAll("style")].find((style) => style.textContent?.includes("@layer tome.reset"));
}

export function previewTheme(theme: ThemeChoice): () => void {
  const style = themeStyle();
  const meta = document.querySelector<HTMLMetaElement>('meta[name="tome-theme"]');
  if (!style) return () => {};
  const before = { css: style.textContent ?? "", theme: meta?.content };
  const kept = before.css.split("\n").filter((line) => !THEME_IMPORT.test(line.trim()));
  const imports = theme.stylesheets.map((file) => `@import url("/themes/${theme.name}/${file}") layer(theme);`);
  const end = kept.at(-1)?.trim() === "" ? kept.length - 1 : kept.length;
  style.textContent = [...kept.slice(0, end), ...imports, ...kept.slice(end)].join("\n");
  if (meta) meta.content = theme.name;
  return () => {
    style.textContent = before.css;
    if (meta && before.theme !== undefined) meta.content = before.theme;
  };
}

export function needsReload(saved: ThemeChoice, themes: readonly ThemeChoice[]): boolean {
  if (saved.name === loadedTheme) return false;
  return saved.script !== undefined || themes.find((theme) => theme.name === loadedTheme)?.script !== undefined;
}
