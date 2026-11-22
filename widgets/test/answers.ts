import { expect } from "vitest";
import type { Locator, Page } from "playwright";
import { type LearningEvent, startWidgetApp } from "./browser.ts";

export const SUBJECT = "spanish";
export const LESSON = "/s/spanish/lessons/answers.html";

export const kinds = (events: LearningEvent[]) => events.map((event) => event.kind);
export const attempts = (events: LearningEvent[]) => events.filter((event) => event.kind === "attempt");

export async function openAnswers(options?: Parameters<typeof startWidgetApp>[0]) {
  const widgets = await startWidgetApp(options);
  const page = await widgets.open(LESSON);
  const choice = page.locator('tome-choice[ref="item:rojo"]');
  const typed = page.locator('tome-typed[ref="item:gracias"]');
  await expect.poll(() => choice.locator(".tome-prompt").textContent()).toBe("Which word means red?");
  await expect.poll(() => typed.locator(".tome-prompt").textContent()).toBe("Say thank you");
  return { ...widgets, page, choice, typed };
}

export async function expectThemeable(page: Page, widget: Locator, names: string[]): Promise<void> {
  expect(await widget.evaluate((element) => element.shadowRoot)).toBeNull();
  for (const name of names) {
    expect(await widget.locator(`.${name}`).count(), name).toBeGreaterThan(0);
  }
  const css = await page.evaluate(() =>
    document.adoptedStyleSheets.flatMap((sheet) => [...sheet.cssRules].map((rule) => rule.cssText)).join("\n"),
  );
  const classes = [...css.replaceAll("@layer tome.widgets", "").matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((match) => match[1]);
  const variables = [...css.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1]);
  expect(css).toContain("@layer tome.widgets");
  expect(classes.filter((name) => !name!.startsWith("tome-"))).toEqual([]);
  expect(variables.filter((name) => !name!.startsWith("--t-"))).toEqual([]);
  expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i);
}
