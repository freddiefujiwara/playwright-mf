import { describe, expect, it, vi } from "vitest";

vi.mock("playwright-extra", () => ({
  default: {
    chromium: {
      use: vi.fn(),
      launch: vi.fn(),
    },
  },
}));

vi.mock("puppeteer-extra-plugin-stealth", () => ({
  default: () => "stealth-plugin",
}));

const { default: portfolio } = await import("../bs-portfolio.js");
const { default: playwrightExtra } = await import("playwright-extra");

const { buildContextOptions, getAuthPaths } = portfolio;
const { chromium } = playwrightExtra;

describe("bs-portfolio helpers", () => {
  it("registers stealth plugin", () => {
    expect(chromium.use).toHaveBeenCalledWith("stealth-plugin");
  });

  it("builds auth paths from homedir", () => {
    const fakeHomedir = () => "/home/tester";
    const join = (...parts) => parts.join("/");

    const paths = getAuthPaths({ homedir: fakeHomedir, join });

    expect(paths).toEqual({
      authDir: "/home/tester/.config/playwright-mf",
      authPath: "/home/tester/.config/playwright-mf/auth.json",
    });
  });

  it("builds context options with storage state", () => {
    const options = buildContextOptions("/tmp/auth.json");

    expect(options).toEqual({
      storageState: "/tmp/auth.json",
      viewport: { width: 1280, height: 800 },
    });
  });
});
