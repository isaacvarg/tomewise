import { LitElement } from "lit";
import { tome } from "./api.ts";

const adopted = new Set<string>();

export function adoptStyles(name: string, css: string): void {
  if (adopted.has(name)) return;
  adopted.add(name);
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`@layer tome.widgets {\n${css}\n}`);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
}

const BASE_CSS = `
.tome-notice { margin: 0; padding: .6rem .8rem; border-radius: var(--t-radius); color: var(--t-bad); background: var(--t-bad-bg); font-family: var(--t-ui); font-size: .9rem; }
`;

export class TomeElement extends LitElement {
  override connectedCallback(): void {
    super.connectedCallback();
    adoptStyles("tome", BASE_CSS);
  }

  protected async completed(): Promise<void> {
    if (this.hasAttribute("final")) await tome.complete();
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
