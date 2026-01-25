const { chromium } = require("playwright-extra");
const path = require("path");
const os = require("os");
const stealth = require("puppeteer-extra-plugin-stealth")();

const getAuthPaths = () => {
  const authDir = path.join(os.homedir(), ".config", "playwright-mf");
  return { authPath: path.join(authDir, "auth.json") };
};

const registerStealth = (chromiumModule = chromium, plugin = stealth) => {
  chromiumModule.use(plugin);
};

const runCfScrape = async () => {
  registerStealth(chromium);
  const { authPath } = getAuthPaths();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: authPath });
  const page = await context.newPage();

  try {
    console.error("Accessing transactions page...");
    await page.goto("https://moneyforward.com/cf", { waitUntil: "networkidle" });

    // Wait for the transaction table to be visible
    await page.waitForSelector("#cf-detail-table", { timeout: 30000 });

    const result = await page.evaluate(() => {
      const norm = (s) => (s ?? "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
      const parseYen = (s) => {
        const n = parseInt(norm(s).replace(/[^-0-9]/g, ""), 10);
        return isNaN(n) ? null : n;
      };

      const data = {
        timestamp: new Date().toISOString(),
        transactions: []
      };

      // Get all rows from the transaction table
      const rows = document.querySelectorAll("#cf-detail-table tbody.list_body tr.transaction_list");

      rows.forEach(tr => {
        const date = norm(tr.querySelector(".date span")?.innerText);
        const content = norm(tr.querySelector(".content div span")?.innerText);
        const amountText = norm(tr.querySelector(".amount span.offset")?.innerText);
        const account = norm(tr.querySelector(".note.calc")?.title);
        const lCategory = norm(tr.querySelector(".lctg .v_l_ctg")?.innerText);
        const sCategory = norm(tr.querySelector(".mctg .v_m_ctg")?.innerText);
        const memo = norm(tr.querySelector(".memo .noform span")?.innerText);

        if (content) {
          data.transactions.push({
            date,           // Date (mm/dd)
            content,        // Content
            amount_yen: parseYen(amountText), // Amount (number)
            account,        // Financial institution
            category_main: lCategory, // Main category
            category_sub: sCategory,  // Sub category
            memo,           // Memo
            is_transfer: tr.classList.contains("mf-grayout") // Whether it is a transfer
          });
        }
      });

      return data;
    });

    console.log(JSON.stringify(result, null, 2));
    console.error(`Scraping complete: Extracted ${result.transactions.length} transactions.`);

  } catch (error) {
    console.error("An error occurred:", error);
    await page.screenshot({ path: "cf-error.png" });
  } finally {
    await browser.close();
  }
};

/* c8 ignore next 3 */
if (require.main === module) {
  runCfScrape();
}

module.exports = { getAuthPaths, registerStealth, runCfScrape };
