const { chromium } = require("playwright-extra");
const {
  normalizeWhitespace,
  parseYen,
  getAuthPaths,
  buildContextOptions,
  registerStealth,
} = require("./lib/scrape-utils");

const normalizeCfResult = (raw) => {
  const transactions = raw.transactions
    .map((row) => {
      const content = normalizeWhitespace(row.content);
      if (!content) return null;
      const amountText = normalizeWhitespace(row.amount_text);
      return {
        date: normalizeWhitespace(row.date),
        content,
        amount_yen: parseYen(amountText),
        account: normalizeWhitespace(row.account),
        category_main: normalizeWhitespace(row.category_main),
        category_sub: normalizeWhitespace(row.category_sub),
        memo: normalizeWhitespace(row.memo),
        is_transfer: Boolean(row.is_transfer),
      };
    })
    .filter(Boolean);

  return {
    timestamp: raw.timestamp,
    transactions,
  };
};

const runCfScrape = async ({
  chromiumModule = chromium,
  authPaths = getAuthPaths(),
  logger = console,
} = {}) => {
  registerStealth(chromiumModule);
  const browser = await chromiumModule.launch({ headless: true });
  const context = await browser.newContext(
    buildContextOptions(authPaths.authPath)
  );
  const page = await context.newPage();

  try {
    logger.error("Accessing transactions page...");
    await page.goto("https://moneyforward.com/cf", {
      waitUntil: "domcontentloaded",
    });

    // Wait for the transaction table to be visible
    await page.waitForSelector("#cf-detail-table", { timeout: 30000 });
    await page.waitForSelector(
      "#cf-detail-table tbody.list_body tr.transaction_list",
      { timeout: 30000 }
    );

    const rawResult = await page.evaluate(() => {
      const text = (node) => node?.innerText ?? "";
      const attr = (node, name) => node?.getAttribute(name) ?? "";
      const data = {
        timestamp: new Date().toISOString(),
        transactions: [],
      };

      // Get all rows from the transaction table
      const rows = document.querySelectorAll(
        "#cf-detail-table tbody.list_body tr.transaction_list"
      );

      rows.forEach(tr => {
        data.transactions.push({
          date: text(tr.querySelector(".date span")),
          content: text(tr.querySelector(".content div span")),
          amount_text: text(tr.querySelector(".amount span.offset")),
          account: attr(tr.querySelector(".note.calc"), "title"),
          category_main: text(tr.querySelector(".lctg .v_l_ctg")),
          category_sub: text(tr.querySelector(".mctg .v_m_ctg")),
          memo: text(tr.querySelector(".memo .noform span")),
          is_transfer: tr.classList.contains("mf-grayout"),
        });
      });

      return data;
    });

    const result = normalizeCfResult(rawResult);

    logger.log(JSON.stringify(result, null, 2));
    logger.error(
      `Scraping complete: Extracted ${result.transactions.length} transactions.`
    );

  } catch (error) {
    logger.error("An error occurred:", error);
    await page.screenshot({ path: "cf-error.png" });
  } finally {
    await browser.close();
  }
};

/* c8 ignore next 3 */
if (require.main === module) {
  runCfScrape();
}

module.exports = {
  buildContextOptions,
  getAuthPaths,
  normalizeCfResult,
  registerStealth,
  runCfScrape,
};
