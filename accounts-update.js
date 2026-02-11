const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth")();
const { getAuthPaths, buildContextOptions, registerStealth } = require("./cf");

/**
 * Update a single account by name.
 */
async function updateAccount(page, name, logger) {
  const updateButtonSelector = `//tr[descendant::a[text()="${name}"]]//input[@value="更新"]`;
  const isVisible = await page.isVisible(updateButtonSelector);

  if (isVisible) {
    logger.error(`Updating "${name}"...`);
    await page.click(updateButtonSelector);
    logger.error(`Update request sent for "${name}".`);
  } else {
    logger.error(`Skipping "${name}": Update button not found.`);
  }
}

/**
 * 指定した口座名の「更新」ボタンをクリックする。
 * 口座名が指定されない場合は、すべての口座を更新する。
 */
const runAccountsUpdate = async (targetAccountNames = [], {
  chromiumModule = chromium,
  authPaths = getAuthPaths(),
  logger = console,
} = {}) => {
  const names = Array.isArray(targetAccountNames) ? targetAccountNames : [targetAccountNames];

  registerStealth(chromiumModule);
  const browser = await chromiumModule.launch({ headless: true });
  const context = await browser.newContext(
    buildContextOptions(authPaths.authPath)
  );
  const page = await context.newPage();

  try {
    logger.error("Navigating to accounts page...");
    await page.goto("https://moneyforward.com/accounts", {
      waitUntil: "domcontentloaded",
    });

    if (names.length === 0) {
      // Update all accounts
      const accounts = await page.$$eval('tr', rows => {
        return rows
          .map(row => {
            const nameEl = row.querySelector('td.service a');
            const updateBtn = row.querySelector('input[value="更新"]');
            return nameEl && updateBtn ? nameEl.innerText.trim() : null;
          })
          .filter(Boolean);
      });

      logger.error(`Found ${accounts.length} updateable accounts.`);
      for (const name of accounts) {
        await updateAccount(page, name, logger);
      }
    } else {
      // Update specified accounts
      for (const name of names) {
        await updateAccount(page, name, logger);
      }
    }

  } catch (error) {
    logger.error("An error occurred during accounts update:", error);
    await page.screenshot({ path: "accounts-update-error.png" });
  } finally {
    // Wait a bit for async requests to be sent
    await page.waitForTimeout(2000);
    await browser.close();
  }
};

/* c8 ignore next 10 */
if (require.main === module) {
  const accountNames = process.argv.slice(2);
  runAccountsUpdate(accountNames).catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { runAccountsUpdate };
