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

const {
  buildContextOptions,
  getAuthPaths,
  registerStealth,
  runPortfolioScrape,
  normalizePortfolioResult,
} = portfolio;

describe("normalizePortfolioResult", () => {
  it("should normalize raw scraped data", () => {
    const rawResult = {
      timestamp: "2024-01-01T00:00:00.000Z",
      breakdown: [
        {
          category: "株式",
          amount_text: "1,000,000円",
          percentage_text: "100%",
        },
      ],
      assetClassRatio: [{ name: "株式", y: 100 }],
      details: [
        {
          id: "portfolio_det_stock",
          category: "株式",
          total_text: "合計：1,000,000円",
          tables: [
            {
              headers: ["銘柄", "評価額"],
              rows: [["A株式会社", "1,000,000円"]],
            },
          ],
        },
      ],
    };

    const expected = {
      timestamp: "2024-01-01T00:00:00.000Z",
      breakdown: [
        {
          category: "株式",
          amount_text: "1,000,000円",
          amount_yen: 1000000,
          percentage_text: "100%",
          percentage: 100,
        },
      ],
      assetClassRatio: [{ name: "株式", y: 100 }],
      details: [
        {
          id: "portfolio_det_stock",
          category: "株式",
          total_text: "1,000,000円",
          total_yen: 1000000,
          tables: [
            {
              headers: ["銘柄", "評価額"],
              items: [{ 銘柄: "A株式会社", 評価額: "1,000,000円" }],
            },
          ],
        },
      ],
      meta: { breakdown: 1, sections: 1, rows: 1 },
    };
    expect(normalizePortfolioResult(rawResult)).toEqual(expected);
  });
  it("should handle empty breakdown and details", () => {
    const rawResult = {
      timestamp: "2024-01-01T00:00:00.000Z",
      breakdown: [],
      assetClassRatio: [],
      details: [],
    };
    const expected = {
      timestamp: "2024-01-01T00:00:00.000Z",
      breakdown: [],
      assetClassRatio: [],
      details: [],
      meta: { breakdown: 0, sections: 0, rows: 0 },
    };
    expect(normalizePortfolioResult(rawResult)).toEqual(expected);
  });
  it("should filter out invalid breakdown items", () => {
    const rawResult = {
      timestamp: "2024-01-01T00:00:00.000Z",
      breakdown: [
        { category: "  ", amount_text: "1,000円", percentage_text: "100%" },
        { category: "株式", amount_text: "1,000円", percentage_text: "100%" },
      ],
      assetClassRatio: [],
      details: [],
    };
    const expected = {
      timestamp: "2024-01-01T00:00:00.000Z",
      breakdown: [
        {
          category: "株式",
          amount_text: "1,000円",
          amount_yen: 1000,
          percentage_text: "100%",
          percentage: 100,
        },
      ],
      assetClassRatio: [],
      details: [],
      meta: { breakdown: 1, sections: 0, rows: 0 },
    };
    expect(normalizePortfolioResult(rawResult)).toEqual(expected);
  });
});

describe("bs-portfolio helpers", () => {
  it("registers stealth plugin", () => {
    registerStealth(chromiumMock, "stealth-plugin");
    expect(chromiumMock.use).toHaveBeenCalledWith("stealth-plugin");
  });

  it("builds auth paths from homedir", () => {
    const fakeHomedir = () => "/home/tester";
    const join = (...parts) => parts.join("/");

    const paths = getAuthPaths({ homedir: fakeHomedir, join, env: {} });

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

describe("runPortfolioScrape", () => {
  it("should scrape portfolio data and log the result", async () => {
    const mockResult = {
      timestamp: "2024-01-01T00:00:00.000Z",
      breakdown: [{ category: "株式", amount_text: "1,000円", percentage_text: "100%" }],
      assetClassRatio: [],
      details: [],
    };
    const expected = {
      timestamp: "2024-01-01T00:00:00.000Z",
      breakdown: [
        {
          category: "株式",
          amount_text: "1,000円",
          amount_yen: 1000,
          percentage_text: "100%",
          percentage: 100,
        },
      ],
      assetClassRatio: [],
      details: [],
      meta: { breakdown: 1, sections: 0, rows: 0 },
    };

    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockResolvedValue(undefined),
      waitForFunction: vi.fn().mockResolvedValue(undefined),
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

    await runPortfolioScrape({
      chromiumModule: chromiumMock,
      authPaths,
      logger,
    });

    expect(page.goto).toHaveBeenCalledWith(
      "https://moneyforward.com/bs/portfolio",
      { waitUntil: "domcontentloaded" }
    );
    expect(page.waitForSelector).toHaveBeenCalledTimes(2);
    expect(page.waitForFunction).toHaveBeenCalled();
    expect(page.evaluate).toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith(
      JSON.stringify(expected, null, 2)
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

    await runPortfolioScrape({
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
