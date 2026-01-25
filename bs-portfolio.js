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

        if (!headers.length) {
          const colCount =
            table.querySelector("tbody tr td")?.length ?? 0;
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
        const category =
          norm(th?.querySelector("a")?.innerText) || norm(th?.innerText);
        if (!category) return;

        data.breakdown.push({
          category,
          amount_text: norm(tds[0]?.innerText),
          amount_yen: parseYen(tds[0]?.innerText),
          percentage_text: norm(tds[1]?.innerText),
          percentage: parsePercent(tds[1]?.innerText),
        });
      });

      data.assetClassRatio = parseAssetClassRatio();

      // details
      document
        .querySelectorAll('[id^="portfolio_det_"]')
        .forEach((sec) => {
          const category = norm(
            sec.querySelector("h1.heading-normal")?.innerText
          );
          const totalText = pickFirst(
            norm(sec.querySelector("h1.heading-small")?.innerText),
            /合計：([0-9,]+円)/
          );

          const tables = Array.from(
            sec.querySelectorAll("table.table-bordered")
          ).map(parseTable);

          data.details.push({
            id: sec.id,
            category,
            total_text: totalText,
            total_yen: parseYen(totalText),
            tables,
          });
        });

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
  registerStealth,
  runPortfolioScrape,
};
