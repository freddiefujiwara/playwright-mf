const { chromium } = require("playwright-extra");
const {
  normalizeWhitespace,
  parseYen,
  getAuthPaths,
  buildContextOptions,
  registerStealth,
} = require("./lib/scrape-utils");

const PREV_BUTTON =
  "button.fc-button-prev.spec-fc-button-click-attached:not(.fc-state-disabled)";
const NEXT_BUTTON =
  "button.fc-button-next.spec-fc-button-click-attached:not(.fc-state-disabled)";
const TITLE_SELECTOR = ".fc-header-title h2";

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

// The calendar header shows the displayed range, e.g. "2026/11/1 - 2026/11/30".
// Returns { year, month } of the range start, or null when unparsable.
const parseDisplayedMonthTitle = (titleText) => {
  const match = String(titleText ?? "").match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
};

// Accepts "YYYY-MM" or { year, month }. Returns { year, month } or null.
const parseTargetMonth = (value) => {
  if (value == null) return null;
  if (typeof value === "object") {
    const year = Number(value.year);
    const month = Number(value.month);
    if (Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12) {
      return { year, month };
    }
    return null;
  }
  const match = String(value).match(/^(\d{4})-(\d{1,2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
};

const monthIndex = ({ year, month }) => year * 12 + (month - 1);

const formatMonth = ({ year, month }) =>
  `${year}-${String(month).padStart(2, "0")}`;

// Returns the dates of transactions that do not belong to the target month.
// Dates look like "09/30" or "09/30(水)".
const findOutOfMonthTransactions = (transactions, target) => {
  const bad = [];
  for (const tx of transactions) {
    const match = String(tx.date ?? "").match(/^(\d{1,2})\/(\d{1,2})/);
    if (!match || Number(match[1]) !== target.month) {
      bad.push(tx.date);
    }
  }
  return bad;
};

const readMonthTitle = async (page) =>
  page.evaluate((selector) => {
    const el = document.querySelector(selector);
    return el ? el.innerText.replace(/\s+/g, " ").trim() : "";
  }, TITLE_SELECTOR);

const TITLE_POLL_INTERVAL_MS = 500;
const TITLE_POLL_MAX = 60; // ~30s of polling before giving up

// Polls the calendar header until it shows a real month range. While the
// calendar re-renders, the header temporarily reads "Loading...", which must
// never be parsed as a month. When previousTitle is given, the header must
// also differ from it, so a not-yet-updated header does not pass either.
const waitForDisplayedMonth = async (page, previousTitle = null) => {
  let lastTitle = "";
  for (let i = 0; i < TITLE_POLL_MAX; i++) {
    lastTitle = await readMonthTitle(page);
    const displayed = parseDisplayedMonthTitle(lastTitle);
    if (displayed && lastTitle !== previousTitle) {
      return { title: lastTitle, displayed };
    }
    await page.waitForTimeout(TITLE_POLL_INTERVAL_MS);
  }
  throw new Error(
    `Timed out waiting for the calendar month title (last: "${lastTitle}")`
  );
};

// Moves the calendar one month at a time until the header shows the target
// month. After every click it waits until the header settles on a new month,
// so a slow re-render can never be mistaken for the target month.
const navigateToTargetMonth = async (page, target, logger = console) => {
  let { title, displayed } = await waitForDisplayedMonth(page);
  let clicks = 0;
  while (monthIndex(displayed) !== monthIndex(target)) {
    if (clicks >= 24) {
      throw new Error(
        `Month navigation did not reach ${formatMonth(target)} (stuck at ${formatMonth(displayed)})`
      );
    }
    const selector =
      monthIndex(displayed) > monthIndex(target) ? PREV_BUTTON : NEXT_BUTTON;
    logger.error(
      `Moving from ${formatMonth(displayed)} toward ${formatMonth(target)}...`
    );
    await page.click(selector, { timeout: 30_000 });
    clicks += 1;
    ({ title, displayed } = await waitForDisplayedMonth(page, title));
  }
  return displayed;
};

// The header can settle on the target month while the table body is still
// re-rendering. Polls until the first row belongs to the target month (or
// there are no rows yet). Never throws: the post-scrape validation judges
// the final state and fails loudly if the rows are still wrong.
const waitForRowsInMonth = async (page, target) => {
  for (let i = 0; i < TITLE_POLL_MAX; i++) {
    const firstMonth = await page.evaluate(() => {
      const el = document.querySelector(
        "#cf-detail-table tbody.list_body tr.transaction_list .date span"
      );
      if (!el) return null;
      const match = el.innerText.trim().match(/^(\d{1,2})\//);
      return match ? Number(match[1]) : null;
    });
    if (firstMonth === null || firstMonth === target.month) return;
    await page.waitForTimeout(TITLE_POLL_INTERVAL_MS);
  }
};

const runCfScrape = async ({
  prevMonths = 0,
  targetMonth = null,
  chromiumModule = chromium,
  authPaths = getAuthPaths(),
  logger = console,
} = {}) => {
  const target = parseTargetMonth(targetMonth);
  if (targetMonth != null && !target) {
    throw new Error(`Invalid target month: ${targetMonth}`);
  }
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

    if (target) {
      logger.error(`Target month: ${formatMonth(target)}`);
      await page.waitForSelector("#cf-detail-table", { timeout: 30000 });
      await navigateToTargetMonth(page, target, logger);
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
      await waitForRowsInMonth(page, target);
    } else if (prevMonths > 0) {
      logger.error(`Moving back ${prevMonths} month(s)...`);
      for (let i = 0; i < prevMonths; i++) {
        await page.click(
          'button.fc-button-prev.spec-fc-button-click-attached' +
          ':not(.fc-state-disabled)',
          { timeout: 30_000 }
        );
        await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
        await page.waitForSelector("#cf-detail-table", { timeout: 30000 });
      }
    }

    // Wait for the transaction table to be visible
    await page.waitForSelector("#cf-detail-table", { timeout: 30000 });
    await page.waitForSelector(
      "#cf-detail-table tbody.list_body tr.transaction_list",
      { timeout: 30000 }
    ).catch(() => {
      // A verified month may legitimately have no transactions; the scrape
      // below then yields an empty list. Other modes keep the old strictness
      // only when rows exist, which the scrape itself establishes.
      if (!target) throw new Error("Transaction rows did not appear");
    });

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
          amount_text: text(tr.querySelector(".amount .noform span")) || text(tr.querySelector(".amount span")),
          account: attr(tr.querySelector(".note.calc"), "title") || text(tr.querySelector(".sub_account_id_hash .noform span")),
          category_main: text(tr.querySelector(".lctg .v_l_ctg")),
          category_sub: text(tr.querySelector(".mctg .v_m_ctg")),
          memo: text(tr.querySelector(".memo .noform span")),
          is_transfer: tr.classList.contains("mf-grayout"),
        });
      });

      return data;
    });

    const result = normalizeCfResult(rawResult);

    if (target) {
      const bad = findOutOfMonthTransactions(result.transactions, target);
      if (bad.length > 0) {
        throw new Error(
          `Transactions outside ${formatMonth(target)} found: ${bad.slice(0, 5).join(", ")}`
        );
      }
      logger.error(
        `Verified: all ${result.transactions.length} transactions belong to ${formatMonth(target)}.`
      );
    }

    logger.log(JSON.stringify(result, null, 2));
    logger.error(
      `Scraping complete: Extracted ${result.transactions.length} transactions.`
    );

    if (target) {
      // Best effort: leave the calendar on the current month, like the
      // legacy -p flow did.
      try {
        await page.click(".fc-button-today");
        await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
      } catch {
        // Returning to today is cosmetic; never fail a verified scrape.
      }
    } else if (prevMonths > 0) {
      logger.error("Returning to current month...");
      await page.click(".fc-button-today");
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
      await page.waitForSelector("#cf-detail-table", { timeout: 30000 });
    }

  } catch (error) {
    logger.error("An error occurred:", error);
    await page.screenshot({ path: "cf-error.png" }).catch(() => {});
    if (target) {
      // In target-month mode a failure must be loud: never let a wrong or
      // partial month flow into the caller's output as if it succeeded.
      throw error;
    }
  } finally {
    await browser.close();
  }
};

/* c8 ignore next 25 */
if (require.main === module) {
  const args = process.argv.slice(2);
  let targetMonth = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--month" && args[i + 1]) {
      targetMonth = args[i + 1];
      break;
    }
    if (args[i] === "-p" && args[i + 1]) {
      const val = parseInt(args[i + 1], 10);
      if (!isNaN(val)) {
        const now = new Date();
        const shifted = new Date(now.getFullYear(), now.getMonth() - val, 1);
        targetMonth = formatMonth({
          year: shifted.getFullYear(),
          month: shifted.getMonth() + 1,
        });
      }
      break;
    }
  }
  runCfScrape({ targetMonth }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  buildContextOptions,
  findOutOfMonthTransactions,
  getAuthPaths,
  navigateToTargetMonth,
  normalizeCfResult,
  parseDisplayedMonthTitle,
  parseTargetMonth,
  registerStealth,
  runCfScrape,
  waitForDisplayedMonth,
  waitForRowsInMonth,
};
