import { JSDOM } from "jsdom";

export const withDom = (html, fn) => {
  const dom = new JSDOM(html);
  const { window } = dom;
  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;

  globalThis.window = window;
  globalThis.document = window.document;

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
  }
};
