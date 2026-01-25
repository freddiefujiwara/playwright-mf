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
  normalizeLiabilityResult,
} = liability;

describe("normalizeLiabilityResult", () => {
  it("should normalize raw scraped data", () => {
    const rawResult = {
      timestamp: "2024-01-01T00:00:00.000Z",
      total: { total_text: "負債総額：1,234,567円" },
      breakdown: [
        {
          category: "住宅ローン",
          amount_text: "1,000,000円",
          percentage_text: "81.00%",
        },
        {
          category: "奨学金",
          amount_text: "234,567円",
          percentage_text: "19.00%",
        },
      ],
      details: [
        {
          id: "liability_det",
          category: "負債詳細",
          tables: [
            {
              headers: ["種類", "金融機関", "残高"],
              rows: [["住宅ローン", "三菱UFJ銀行", "1,000,000円"]],
            },
          ],
        },
      ],
    };
    const expected = {
      timestamp: "2024-01-01T00:00:00.000Z",
      total: { total_text: "1,234,567円", total_yen: 1234567 },
      breakdown: [
        {
          category: "住宅ローン",
          amount_text: "1,000,000円",
          amount_yen: 1000000,
          percentage_text: "81.00%",
          percentage: 81,
        },
        {
          category: "奨学金",
          amount_text: "234,567円",
          amount_yen: 234567,
          percentage_text: "19.00%",
          percentage: 19,
        },
      ],
      details: [
        {
          id: "liability_det",
          category: "負債詳細",
          tables: [
            {
              headers: ["種類", "金融機関", "残高"],
              items: [
                {
                  種類: "住宅ローン",
                  金融機関: "三菱UFJ銀行",
                  残高: "1,000,000円",
                  残高_yen: 1000000,
                },
              ],
            },
          ],
        },
      ],
      meta: { breakdown: 2, sections: 1, rows: 1 },
    };
    expect(normalizeLiabilityResult(rawResult)).toEqual(expected);
  });

  it("should handle empty breakdown and details", () => {
    const rawResult = {
      timestamp: "2024-01-01T00:00:00.000Z",
      total: { total_text: "負債総額：0円" },
      breakdown: [],
      details: [],
    };
    const expected = {
      timestamp: "2024-01-01T00:00:00.000Z",
      total: { total_text: "0円", total_yen: 0 },
      breakdown: [],
      details: [],
      meta: { breakdown: 0, sections: 0, rows: 0 },
    };
    expect(normalizeLiabilityResult(rawResult)).toEqual(expected);
  });

  it("should filter out invalid breakdown items", () => {
    const rawResult = {
      timestamp: "2024-01-01T00:00:00.000Z",
      total: { total_text: "負債総額：1,000円" },
      breakdown: [
        { category: "  ", amount_text: "1,000円", percentage_text: "100%" },
        {
          category: "奨学金",
          amount_text: "1,000円",
          percentage_text: "100%",
        },
      ],
      details: [],
    };
    const expected = {
      timestamp: "2024-01-01T00:00:00.000Z",
      total: { total_text: "1,000円", total_yen: 1000 },
      breakdown: [
        {
          category: "奨学金",
          amount_text: "1,000円",
          amount_yen: 1000,
          percentage_text: "100%",
          percentage: 100,
        },
      ],
      details: [],
      meta: { breakdown: 1, sections: 0, rows: 0 },
    };
    expect(normalizeLiabilityResult(rawResult)).toEqual(expected);
  });

  it("should handle alternative detail table columns", () => {
    const rawResult = {
      timestamp: "2024-01-01T00:00:00.000Z",
      total: { total_text: "負債総額：1,000円" },
      breakdown: [],
      details: [
        {
          id: "liability_det",
          category: "負債詳細",
          tables: [
            {
              headers: ["col_1", "col_2", "col_3"],
              rows: [["val_1", "val_2", "1,000円"]],
            },
          ],
        },
      ],
    };
    const expected = {
      timestamp: "2024-01-01T00:00:00.000Z",
      total: { total_text: "1,000円", total_yen: 1000 },
      breakdown: [],
      details: [
        {
          id: "liability_det",
          category: "負債詳細",
          tables: [
            {
              headers: ["col_1", "col_2", "col_3"],
              items: [{ col_1: "val_1", col_2: "val_2", col_3: "1,000円", "残高_yen": 1000 }],
            },
          ],
        },
      ],
      meta: { breakdown: 0, sections: 1, rows: 1 },
    };
    expect(normalizeLiabilityResult(rawResult)).toEqual(expected);
  });
});

describe("bs-liability helpers", () => {
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

describe("runLiabilityScrape", () => {
  it("should scrape liability data and log the result", async () => {
    const mockResult = {
      timestamp: "2024-01-01T00:00:00.000Z",
      total: { total_text: "負債総額：1,000円" },
      breakdown: [
        {
          category: "住宅ローン",
          amount_text: "1,000円",
          percentage_text: "100%",
        },
      ],
      details: [],
    };
    const expected = {
      timestamp: "2024-01-01T00:00:00.000Z",
      total: { total_text: "1,000円", total_yen: 1000 },
      breakdown: [
        {
          category: "住宅ローン",
          amount_text: "1,000円",
          amount_yen: 1000,
          percentage_text: "100%",
          percentage: 100,
        },
      ],
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
