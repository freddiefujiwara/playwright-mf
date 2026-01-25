import { JSDOM } from "jsdom";

export const withDom = (html, fn) => {
  const dom = new JSDOM(html);
  const { window } = dom;
  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  const prevHTMLElement = globalThis.HTMLElement;

  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;

  if (!("innerText" in window.HTMLElement.prototype)) {
    Object.defineProperty(window.HTMLElement.prototype, "innerText", {
      configurable: true,
      get() {
        return this.textContent ?? "";
      },
      set(value) {
        this.textContent = value ?? "";
      },
    });
  }

  try {
    return fn();
  } finally {
    window.close();
    if (prevWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = prevWindow;
    }
    if (prevDocument === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = prevDocument;
    }
    if (prevHTMLElement === undefined) {
      delete globalThis.HTMLElement;
    } else {
      globalThis.HTMLElement = prevHTMLElement;
    }
  }
};
