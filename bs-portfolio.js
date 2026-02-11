const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth")();
const {
  normalizeWhitespace,
  parsePercent,
  parseTableData,
  parseYen,
  pickFirst,
  getAuthPaths,
  buildContextOptions,
  registerStealth,
} = require("./lib/scrape-utils");

const normalizePortfolioResult = (raw) => {
  const breakdown = raw.breakdown
    .map((row) => {
      const category = normalizeWhitespace(row.category);
      if (!category) return null;
      const amountText = normalizeWhitespace(row.amount_text);
      const percentageText = normalizeWhitespace(row.percentage_text);
      return {
        category,
        amount_text: amountText,
        amount_yen: parseYen(amountText),
        percentage_text: percentageText,
        percentage: parsePercent(percentageText),
      };
    })
    .filter(Boolean);

  const details = raw.details.map((detail) => {
    const category = normalizeWhitespace(detail.category);
    const totalText = pickFirst(
      normalizeWhitespace(detail.total_text),
      /合計：([0-9,]+円)/
    );
    const tables = detail.tables.map((table) =>
      parseTableData({
        headers: table.headers,
        rows: table.rows,
      })
    );

    return {
      id: detail.id,
      category,
      total_text: totalText,
      total_yen: parseYen(totalText),
      tables,
    };
  });

  const meta = {
    breakdown: breakdown.length,
    sections: details.length,
    rows: details.reduce(
      (acc, section) =>
        acc + section.tables.reduce((sum, table) => sum + table.items.length, 0),
      0
    ),
  };

  return {
    timestamp: raw.timestamp,
    breakdown,
    assetClassRatio: raw.assetClassRatio,
    details,
    meta,
  };
};

const runPortfolioScrape = async ({
  chromiumModule = chromium,
  authPaths = getAuthPaths(),
  logger = console,
} = {}) => {
  registerStealth(chromiumModule, stealth);
  const browser = await chromiumModule.launch({ headless: true });
  const context = await browser.newContext(
    buildContextOptions(authPaths.authPath)
  );
  const page = await context.newPage();

  try {
    logger.error("Accessing portfolio page...");
    await page.goto("https://moneyforward.com/bs/portfolio", {
      waitUntil: "domcontentloaded",
    });

    await page.waitForSelector("section.bs-total-assets table.table-bordered", {
      timeout: 30000,
    });
    await page.waitForSelector('[id^="portfolio_det_"] table.table-bordered', {
      timeout: 30000,
    });
    await page.waitForFunction(
      () =>
        document.querySelectorAll(
          "section.bs-total-assets table.table-bordered tbody tr"
        ).length > 0,
      { timeout: 30000 }
    );

    const rawResult = await page.evaluate(() => {
      const text = (node) => node?.innerText ?? "";
      const parseTable = (table) => ({
        headers: Array.from(table.querySelectorAll("thead th")).map((th) =>
          text(th)
        ),
        rows: Array.from(table.querySelectorAll("tbody tr")).map((tr) =>
          Array.from(tr.querySelectorAll("td")).map((td) => text(td))
        ),
      });

      const parseAssetClassRatio = () => {
        const re = /var\s+assetClassRatio\s*=\s*(\[[\s\S]*?\]);/;
        for (const s of document.querySelectorAll("script")) {
          const m = (s.textContent || "").match(re);
          if (m) {
            try {
              return JSON.parse(m[1]);
            } catch {
              return Function(`return (${m[1]})`)();
            }
          }
        }
        return null;
      };

      const data = {
        timestamp: new Date().toISOString(),
        breakdown: [],
        assetClassRatio: null,
        details: [],
      };

      // breakdown
      const summaryTable = document.querySelector(
        "section.bs-total-assets table.table-bordered"
      );
      summaryTable?.querySelectorAll("tbody tr").forEach((tr) => {
        const th = tr.querySelector("th");
        const tds = tr.querySelectorAll("td");
        const category = text(th?.querySelector("a")) || text(th);
        if (!category) return;

        data.breakdown.push({
          category,
          amount_text: text(tds[0]),
          percentage_text: text(tds[1]),
        });
      });

      data.assetClassRatio = parseAssetClassRatio();

      // details
      document
        .querySelectorAll('[id^="portfolio_det_"]')
        .forEach((sec) => {
          const category = text(sec.querySelector("h1.heading-normal"));
          const totalText = text(sec.querySelector("h1.heading-small"));
          const tables = Array.from(
            sec.querySelectorAll("table.table-bordered")
          ).map(parseTable);

          data.details.push({
            id: sec.id,
            category,
            total_text: totalText,
            tables,
          });
        });

      return data;
    });

    const result = normalizePortfolioResult(rawResult);

    // ===== Output =====
    logger.log(JSON.stringify(result, null, 2));

    logger.error("Data scraping complete");
    logger.error(
      `breakdown=${result.meta.breakdown}, sections=${result.meta.sections}, rows=${result.meta.rows}`
    );
  } catch (error) {
    logger.error("Error:", error);
    await page.screenshot({ path: "debug-error.png", fullPage: true });
  } finally {
    await browser.close();
  }
};

/* c8 ignore next 3 */
if (require.main === module) {
  runPortfolioScrape();
}

module.exports = {
  buildContextOptions,
  getAuthPaths,
  normalizePortfolioResult,
  registerStealth,
  runPortfolioScrape,
};
