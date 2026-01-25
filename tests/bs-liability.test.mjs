import { describe, expect, it, vi } from "vitest";

const chromiumMock = {
  use: vi.fn(),
  launch: vi.fn(),
};

vi.mock("playwright-extra", () => ({
  chromium: chromiumMock,
}));

vi.mock("puppeteer-extra-plugin-stealth", () => () => "stealth-plugin");

const { default: liability } = await import("../bs-liability.js");

const {
  buildContextOptions,
  getAuthPaths,
  registerStealth,
  runLiabilityScrape,
} = liability;

describe("bs-liability helpers", () => {
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

describe("runLiabilityScrape", () => {
  it("should scrape liability data and log the result", async () => {
    const mockResult = {
      timestamp: "2024-01-01T00:00:00.000Z",
      total: { total_text: "負債総額：1,000円", total_yen: 1000 },
      breakdown: [{ category: "住宅ローン", amount_yen: 1000 }],
      details: [],
      meta: { breakdown: 1, sections: 0, rows: 0 },
    };

    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(mockResult),
      screenshot: vi.fn().mockResolvedValue(undefined),
    };
    const context = { newPage: vi.fn().mockResolvedValue(page) };
    const browser = {
      newContext: vi.fn().mockResolvedValue(context),
      close: vi.fn().mockResolvedValue(undefined),
    };
    chromiumMock.launch.mockResolvedValue(browser);

    const logger = { log: vi.fn(), error: vi.fn() };
    const authPaths = {
      authDir: "/tmp/auth",
      authPath: "/tmp/auth/auth.json",
    };

    await runLiabilityScrape({
      chromiumModule: chromiumMock,
      authPaths,
      logger,
    });

    expect(page.goto).toHaveBeenCalledWith(
      "https://moneyforward.com/bs/liability",
      { waitUntil: "domcontentloaded" }
    );
    expect(page.waitForSelector).toHaveBeenCalledTimes(3);
    expect(page.evaluate).toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith(
      JSON.stringify(mockResult, null, 2)
    );
    expect(browser.close).toHaveBeenCalled();
  });

  it("should handle errors during scraping", async () => {
    const error = new Error("Scraping failed");
    const page = {
      goto: vi.fn().mockRejectedValue(error),
      screenshot: vi.fn().mockResolvedValue(undefined),
    };
    const context = { newPage: vi.fn().mockResolvedValue(page) };
    const browser = {
      newContext: vi.fn().mockResolvedValue(context),
      close: vi.fn().mockResolvedValue(undefined),
    };
    chromiumMock.launch.mockResolvedValue(browser);

    const logger = { log: vi.fn(), error: vi.fn() };
    const authPaths = {
      authDir: "/tmp/auth",
      authPath: "/tmp/auth/auth.json",
    };

    await runLiabilityScrape({
      chromiumModule: chromiumMock,
      authPaths,
      logger,
    });

    expect(logger.error).toHaveBeenCalledWith("Error:", error);
    expect(page.screenshot).toHaveBeenCalledWith({
      path: "debug-error.png",
      fullPage: true,
    });
    expect(browser.close).toHaveBeenCalled();
  });
});
