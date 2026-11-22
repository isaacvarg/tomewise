import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Browser, Page } from "playwright";
import { startServer, STYLEGUIDE } from "@tomewise/app";
import { findLearningHome, loadLearningHome, requiredTokenNames } from "@tomewise/core";
import type { Io } from "./main.ts";

export const THEME_USAGE = "  tome theme check <name> [--out <dir>]";

export const WIDTHS = [375, 768, 1280] as const;
export const MODES = ["light", "dark"] as const;
type Mode = (typeof MODES)[number];


export interface Problem {
  width?: number;
  mode: Mode;
  message: string;
}

interface PageFindings {
  theme: string | null;
  missing: string[];
  contrast: { ratio: number; needs: number; element: string }[];
  overflow: { width: number; element: string }[];
}

function inPage(required: string[]): PageFindings {
  type Rgba = [number, number, number, number];
  const parse = (color: string): Rgba => {
    const parts = color.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0];
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
  };
  const over = ([r, g, b, a]: Rgba, [br, bg, bb]: Rgba): Rgba => [
    r * a + br * (1 - a),
    g * a + bg * (1 - a),
    b * a + bb * (1 - a),
    1,
  ];
  const luminance = ([r, g, b]: Rgba) => {
    const channel = (value: number) => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const ratio = (a: Rgba, b: Rgba) => {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (light! + 0.05) / (dark! + 0.05);
  };

  const root = document.documentElement;
  const canvas: Rgba = getComputedStyle(root).colorScheme.includes("dark") ? [18, 18, 18, 1] : [255, 255, 255, 1];

  function backgroundOf(element: Element | null): Rgba {
    const layers: Rgba[] = [];
    for (let node = element; node; node = node.parentElement) {
      const color = parse(getComputedStyle(node).backgroundColor);
      if (color[3] > 0) layers.push(color);
      if (color[3] >= 1) break;
    }
    return layers.reduceRight<Rgba>((below, layer) => over(layer, below), canvas);
  }

  function opacityOf(element: Element): number {
    let opacity = 1;
    for (let node: Element | null = element; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
    return opacity;
  }

  function describe(element: Element): string {
    const tag = element.localName;
    const first = [...element.classList][0];
    const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
    const where = element.closest("figure")?.querySelector("figcaption")?.textContent?.trim();
    const section = element.closest("section")?.querySelector("h2")?.textContent?.trim();
    const place = [section, where].filter(Boolean).join(" · ");
    return `${first ? `${tag}.${first}` : tag}${text ? ` "${text.length > 40 ? `${text.slice(0, 39)}…` : text}"` : ""}${place ? ` in ${place}` : ""}`;
  }

  const visible = (element: Element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };

  const contrast: PageFindings["contrast"] = [];
  for (const element of document.body.querySelectorAll("*")) {
    const ownText = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim() !== "");
    if (!ownText || !visible(element) || element.matches("script, style, option")) continue;
    if (element.closest(":disabled, [aria-disabled='true'], [aria-hidden='true'], [inert]")) continue;
    if (element.closest("[class^='tome-'][data-state='error']") && !element.closest(".tome-notice")) continue;
    const style = getComputedStyle(element);
    const background = backgroundOf(element);
    const text = parse(style.color);
    const foreground = over([text[0], text[1], text[2], text[3] * opacityOf(element)], background);
    const size = parseFloat(style.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
    const needs = large ? 3 : 4.5;
    const measured = ratio(foreground, background);
    if (measured < needs) contrast.push({ ratio: Math.floor(measured * 100) / 100, needs, element: describe(element) });
  }

  const viewport = root.clientWidth;
  const clips = (element: Element) => {
    for (let node = element.parentElement; node && node !== root; node = node.parentElement) {
      if (getComputedStyle(node).overflowX !== "visible") return true;
    }
    return false;
  };
  const overflowing = [...document.body.querySelectorAll("*")].filter((element) => {
    if (!visible(element) || clips(element)) return false;
    const box = element.getBoundingClientRect();
    return box.right > viewport + 1 || box.left < -1;
  });
  const outermost = overflowing.filter((element) => !overflowing.includes(element.parentElement!));
  const overflow = outermost.map((element) => ({
    width: Math.round(element.getBoundingClientRect().width),
    element: describe(element).replace(/ "[^"]*"/, ""),
  }));
  if (overflow.length === 0 && root.scrollWidth > viewport) overflow.push({ width: root.scrollWidth, element: "the page" });

  const tokens = getComputedStyle(root);
  return {
    theme: document.querySelector<HTMLMetaElement>('meta[name="tome-theme"]')?.content ?? null,
    missing: required.filter((name) => tokens.getPropertyValue(name).trim() === ""),
    contrast,
    overflow,
  };
}

async function loadPlaywright(io: Io): Promise<typeof import("playwright") | undefined> {
  try {
    return await import("playwright");
  } catch {
    io.stderr(
      "tome theme check needs Playwright. In a clone of the repo it is already installed. Otherwise run it with\n" +
        "  npx -p tomewise -p playwright tome theme check <name>\n" +
        "after `npx playwright install chromium`.",
    );
    return undefined;
  }
}

async function launch(io: Io, playwright: typeof import("playwright")): Promise<Browser | undefined> {
  try {
    return await playwright.chromium.launch({ channel: "chromium" });
  } catch (error) {
    io.stderr(`Couldn't start Chromium for the check. Run \`npx playwright install chromium\`.\n${(error as Error).message}`);
    return undefined;
  }
}

async function homeRoot(io: Io): Promise<string> {
  try {
    return await findLearningHome({ cwd: io.cwd, env: io.env });
  } catch {
    return join(STYLEGUIDE, "home");
  }
}

async function checkPage(page: Page, url: string): Promise<PageFindings> {
  await page.goto(url);
  await page.waitForFunction(() => document.documentElement.dataset.styleguide, undefined, { timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(inPage, requiredTokenNames());
}

export async function themeCheck(io: Io, args: string[], usage: string): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({ args, allowPositionals: true, options: { out: { type: "string" } } });
  } catch (error) {
    io.stderr((error as Error).message);
    return 1;
  }
  const [action, name, ...extra] = parsed.positionals;
  if (action !== "check" || !name || extra.length > 0) {
    io.stderr(usage);
    return 1;
  }

  const home = await loadLearningHome(await homeRoot(io));
  const playwright = await loadPlaywright(io);
  if (!playwright) return 1;
  const out = parsed.values.out ? resolve(io.cwd, parsed.values.out) : await mkdtemp(join(tmpdir(), `tomewise-theme-${name}-`));
  await mkdir(out, { recursive: true });

  const server = await startServer(home, { host: "127.0.0.1", port: 0, tool: io.tool, warn: () => {} });
  const browser = await launch(io, playwright);
  if (!browser) {
    await server.close();
    return 1;
  }

  const problems: Problem[] = [];
  try {
    io.stdout(`Checking ${name} at ${WIDTHS.join(", ")} px wide, in light and dark`);
    for (const mode of MODES) {
      const missingInMode = new Set<string>();
      for (const width of WIDTHS) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: mode, reducedMotion: "reduce" });
        try {
          const page = await context.newPage();
          const findings = await checkPage(page, `${server.url}/styleguide?theme=${encodeURIComponent(name)}`);
          if (findings.theme !== name) {
            io.stderr(`No theme "${name}" in themes/ or the built-in themes.`);
            return 1;
          }
          for (const token of findings.missing) missingInMode.add(token);
          for (const { ratio, needs, element } of findings.contrast) {
            problems.push({ width, mode, message: `contrast ${ratio.toFixed(2)}:1, needs ${needs}:1 · ${element}` });
          }
          for (const { width: wide, element } of findings.overflow) {
            problems.push({ width, mode, message: `overflow · ${element} is ${wide}px wide, wider than the ${width}px viewport` });
          }
          await page.screenshot({ path: join(out, `${name}-${width}-${mode}.png`), fullPage: true });
        } finally {
          await context.close();
        }
      }
      for (const token of missingInMode) problems.unshift({ mode, message: `missing token ${token}` });
    }
  } finally {
    await browser.close();
    await server.close();
  }

  const grouped = new Map<string, { mode: Mode; message: string; widths: number[] }>();
  for (const { width, mode, message } of problems) {
    const key = `${mode} ${message}`;
    const group = grouped.get(key) ?? { mode, message, widths: [] };
    if (width !== undefined) group.widths.push(width);
    grouped.set(key, group);
  }
  for (const { mode, message, widths } of grouped.values()) {
    io.stdout(`✗ ${widths.length > 0 ? `${widths.join(", ")}px ` : ""}${mode}: ${message}`);
  }
  io.stdout(`Screenshots: ${out}`);
  if (grouped.size > 0) {
    io.stdout(`${grouped.size} ${grouped.size === 1 ? "problem" : "problems"} in ${name}`);
    return 1;
  }
  io.stdout(`${name} passes: no missing tokens, contrast or overflow problems.`);
  return 0;
}
