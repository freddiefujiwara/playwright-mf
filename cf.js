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
    console.error("入出金ページにアクセス中...");
    await page.goto("https://moneyforward.com/cf", { waitUntil: "networkidle" });

    // 明細テーブルが表示されるまで待機
    await page.waitForSelector("#transaction_list", { timeout: 30000 });

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

      // 明細テーブルの行を取得
      const rows = document.querySelectorAll("#transaction_list tbody tr.transaction_t");

      rows.forEach(tr => {
        const date = norm(tr.querySelector(".td-date")?.innerText);
        const content = norm(tr.querySelector(".td-content")?.innerText);
        const amountText = norm(tr.querySelector(".td-amount")?.innerText);
        const account = norm(tr.querySelector(".td-account")?.innerText);
        const lCategory = norm(tr.querySelector(".td-large-category")?.innerText);
        const sCategory = norm(tr.querySelector(".td-middle-category")?.innerText);
        const memo = norm(tr.querySelector(".td-memo")?.innerText);

        if (content) {
          data.transactions.push({
            date,           // 日付 (mm/dd)
            content,        // 内容
            amount_yen: parseYen(amountText), // 金額 (数値)
            account,        // 保有金融機関
            category_main: lCategory, // 大項目
            category_sub: sCategory,  // 中項目
            memo,           // メモ
            is_transfer: tr.classList.contains("transfer") // 振替かどうか
          });
        }
      });

      return data;
    });

    console.log(JSON.stringify(result, null, 2));
    console.error(`取得完了: ${result.transactions.length} 件の明細を抽出しました。`);

  } catch (error) {
    console.error("エラーが発生しました:", error);
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
