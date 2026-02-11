// bs-liability.js
//
// This script scrapes the MoneyForward "Liabilities" page and outputs the data
// in a JSON format similar to bs-portfolio.js.
// - Uses ~/.config/playwright-mf/auth.json as storageState (assumes login).
// - breakdown (liability breakdown)
// - total (total liabilities)
// - details (liability details table)
//
// Usage:
//   node bs-liability.js > liability.json
//
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

const normalizeLiabilityResult = (raw) => {
  const totalText = pickFirst(
    normalizeWhitespace(raw.total?.total_text),
    /負債総額：\s*([0-9,]+円)/
  );
  const total = {
    total_text: totalText,
    total_yen: parseYen(totalText),
  };

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
    const tables = detail.tables.map((table) => {
      const parsed = parseTableData({
        headers: table.headers,
        rows: table.rows,
      });
      const items = parsed.items.map((row) => {
        const balanceText = row["残高"] ?? row["col_3"] ?? "";
        return {
          ...row,
          残高_yen: parseYen(balanceText),
        };
      });
      return { ...parsed, items };
    });

    return {
      id: detail.id,
      category: normalizeWhitespace(detail.category) || "負債詳細",
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
    total,
    breakdown,
    details,
    meta,
  };
};

const runLiabilityScrape = async ({
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
    logger.error("Accessing liabilities page...");
    await page.goto("https://moneyforward.com/bs/liability", {
      waitUntil: "domcontentloaded",
    });

    // "Total Liabilities" box, "Liability Breakdown" table, "Liability Details" table
    await page.waitForSelector("#bs-liability section.bs-liability", {
      timeout: 30000,
    });
    await page.waitForSelector("#bs-liability .liability-summary table.table-bordered", {
      timeout: 30000,
    });
    await page.waitForSelector("#liability_det table.table-det", {
      timeout: 30000,
    });
    await page.waitForFunction(
      () =>
        document.querySelectorAll(
          "#bs-liability .liability-summary table.table-bordered tbody tr"
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

      const data = {
        timestamp: new Date().toISOString(),
        total: {
          total_text: "",
        },
        breakdown: [],
        details: [],
        meta: {},
      };

      // ===== total (Total Liabilities) =====
      // HTML example: <div class="heading-radius-box">負債総額：12,684,157円</div>
      const totalBox = document.querySelector(
        "#bs-liability section.bs-liability .heading-radius-box"
      );
      data.total.total_text = text(totalBox);

      // ===== breakdown (Liability Breakdown) =====
      // HTML example: <div class="liability-summary">... <table class="table table-bordered"> <tr> <th>...<a>種類</a> <td>金額</td><td>%</td> </th> </tr>
      const summaryTable = document.querySelector(
        "#bs-liability .liability-summary section.bs-total-assets table.table-bordered"
      );
      if (summaryTable) {
        summaryTable.querySelectorAll("tr").forEach((tr) => {
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
      }

      // ===== details (Liability Details) =====
      // Parse #liability_det table.table-det and also add numeric values for the balance column
      const detTable = document.querySelector("#liability_det table.table-det");
      if (detTable) {
        const parsed = parseTable(detTable);
        data.details.push({
          id: "liability_det",
          category: text(
            document.querySelector("#liability_det h1.heading-normal")
          ),
          tables: [parsed],
        });
      }
      return data;
    });

    const result = normalizeLiabilityResult(rawResult);

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
  runLiabilityScrape();
}

module.exports = {
  buildContextOptions,
  getAuthPaths,
  normalizeLiabilityResult,
  registerStealth,
  runLiabilityScrape,
};
