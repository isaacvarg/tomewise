const CSS = `@layer tome.widgets {
.tome-notice { margin: 0; padding: .6rem .8rem; border-radius: var(--t-radius); color: var(--t-bad); background: var(--t-bad-bg); font-family: var(--t-ui); font-size: .9rem; }
.tome-notice[data-state="unsaved"] { margin-top: .5rem; }
}`;

const UNSAVED = ':scope > .tome-notice[data-state="unsaved"]';
const styled = new WeakSet<Document>();

function style(doc: Document): void {
  if (styled.has(doc)) return;
  styled.add(doc);
  const sheet = new (doc.defaultView ?? window).CSSStyleSheet();
  sheet.replaceSync(CSS);
  doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
}

export function showUnsaved(widget: Element, message: string): void {
  const doc = widget.ownerDocument;
  style(doc);
  let notice = widget.querySelector(UNSAVED);
  if (!notice) {
    notice = doc.createElement("p");
    notice.className = "tome-notice";
    notice.setAttribute("role", "alert");
    notice.setAttribute("data-state", "unsaved");
  }
  notice.textContent = message;
  widget.append(notice);
}

export function clearUnsaved(widget: Element): void {
  widget.querySelector(UNSAVED)?.remove();
}
