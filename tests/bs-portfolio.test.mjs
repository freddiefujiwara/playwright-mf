import { describe, expect, it, vi } from "vitest";

const chromiumMock = {
  use: vi.fn(),
  launch: vi.fn(),
};

vi.mock("playwright-extra", () => ({
  chromium: chromiumMock,
}));

vi.mock("puppeteer-extra-plugin-stealth", () => () => "stealth-plugin");

const { default: portfolio } = await import("../bs-portfolio.js");

const { buildContextOptions, getAuthPaths, registerStealth } = portfolio;

describe("bs-portfolio helpers", () => {
  it("registers stealth plugin", () => {
    registerStealth(chromiumMock, "stealth-plugin");
    expect(chromiumMock.use).toHaveBeenCalledWith("stealth-plugin");
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
