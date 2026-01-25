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
const path = require("path");
const os = require("os");
const stealth = require("puppeteer-extra-plugin-stealth")();

const getAuthPaths = ({
  homedir = os.homedir,
  join = path.join,
} = {}) => {
  const authDir = join(homedir(), ".config", "playwright-mf");
  return {
    authDir,
    authPath: join(authDir, "auth.json"),
  };
};

const buildContextOptions = (authPath) => ({
  storageState: authPath,
  viewport: { width: 1280, height: 800 },
});

const registerStealth = (chromiumModule = chromium, plugin = stealth) => {
  chromiumModule.use(plugin);
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

    const result = await page.evaluate(() => {
      const norm = (s) =>
        (s ?? "")
          .replace(/\u00a0/g, " ")
          .replace(/[ \t]+/g, " ")
          .replace(/\r?\n+/g, "\n")
          .trim();

      const parseYen = (s) => {
        const t = norm(s).replace(/円/g, "").replace(/,/g, "");
        if (!t) return null;
        const n = Number(t);
        return Number.isFinite(n) ? n : null;
      };

      const parsePercent = (s) => {
        const t = norm(s).replace(/%/g, "");
        if (!t) return null;
        const n = Number(t);
        return Number.isFinite(n) ? n : null;
      };

      const pickFirst = (str, re) => {
        const m = (str || "").match(re);
        return m ? m[1] : "";
      };

      const parseTable = (table) => {
        const actionHeaders = new Set(["変更", "削除"]);
        let headers = Array.from(table.querySelectorAll("thead th")).map((th) =>
          norm(th.innerText)
        );

        // Fallback for cases where thead is missing/empty (estimate from td count in the first tbody row)
        if (!headers.length) {
          const colCount =
            table.querySelectorAll("tbody tr:first-child td").length || 0;
          headers = Array.from({ length: colCount }, (_, i) => `col_${i + 1}`);
        }

        const keepIdx = headers
          .map((h, i) => ({ h, i }))
          .filter(({ h }) => !actionHeaders.has(h))
          .map(({ i }) => i);

        const items = [];
        table.querySelectorAll("tbody tr").forEach((tr) => {
          const tds = Array.from(tr.querySelectorAll("td")).map((td) =>
            norm(td.innerText)
          );
          if (!tds.some((v) => v !== "")) return;

          const row = {};
          keepIdx.forEach((i) => {
            row[headers[i] ?? `col_${i + 1}`] = tds[i] ?? "";
          });
          items.push(row);
        });

        return { headers: keepIdx.map((i) => headers[i]), items };
      };

      const data = {
        timestamp: new Date().toISOString(),
        total: {
          total_text: "",
          total_yen: null,
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
      const totalText = pickFirst(norm(totalBox?.innerText), /負債総額：\s*([0-9,]+円)/);
      data.total.total_text = totalText;
      data.total.total_yen = parseYen(totalText);

      // ===== breakdown (Liability Breakdown) =====
      // HTML example: <div class="liability-summary">... <table class="table table-bordered"> <tr> <th>...<a>種類</a> <td>金額</td><td>%</td> </th> </tr>
      const summaryTable = document.querySelector(
        "#bs-liability .liability-summary section.bs-total-assets table.table-bordered"
      );
      if (summaryTable) {
        summaryTable.querySelectorAll("tr").forEach((tr) => {
          const th = tr.querySelector("th");
          const tds = tr.querySelectorAll("td");
          const category =
            norm(th?.querySelector("a")?.innerText) || norm(th?.innerText);

          if (!category) return;

          const amountText = norm(tds[0]?.innerText);
          const pctText = norm(tds[1]?.innerText);

          data.breakdown.push({
            category,
            amount_text: amountText,
            amount_yen: parseYen(amountText),
            percentage_text: pctText,
            percentage: parsePercent(pctText),
          });
        });
      }

      // ===== details (Liability Details) =====
      // Parse #liability_det table.table-det and also add numeric values for the balance column
      const detTable = document.querySelector("#liability_det table.table-det");
      if (detTable) {
        const parsed = parseTable(detTable);

        // As a convenience field, add the balance (in yen) as a numeric value (assuming column name is "残高")
        const items = parsed.items.map((row) => {
          const balanceText = row["残高"] ?? row["col_3"] ?? "";
          return {
            ...row,
            残高_yen: parseYen(balanceText),
          };
        });

        data.details.push({
          id: "liability_det",
          category: norm(document.querySelector("#liability_det h1.heading-normal")?.innerText) || "負債詳細",
          tables: [{ ...parsed, items }],
        });
      }

      data.meta = {
        breakdown: data.breakdown.length,
        sections: data.details.length,
        rows: data.details.reduce(
          (a, s) => a + s.tables.reduce((b, t) => b + t.items.length, 0),
          0
        ),
      };

      return data;
    });

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
  registerStealth,
  runLiabilityScrape,
};
