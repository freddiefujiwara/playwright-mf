const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth")();
const { getAuthPaths, buildContextOptions, registerStealth } = require("./cf"); // 既存の共通設定を再利用

/**
 * 指定した口座名の「更新」ボタンをクリックする
 */
const runAccountUpdate = async (targetAccountName, {
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
    logger.error(`Navigating to accounts page to update: ${targetAccountName}`);
    await page.goto("https://moneyforward.com/accounts", {
      waitUntil: "domcontentloaded",
    });

    // 口座名が含まれる行を特定し、その行の中にある更新ボタンを取得
    // 1. ユーザーが指定した口座名を持つ <a> タグを探す
    // 2. その <a> タグの親要素（tr）に遡る
    // 3. その行内の「更新」ボタン（input[value="更新"]）をクリックする
    const updateButtonSelector = `//tr[descendant::a[text()="${targetAccountName}"]]//input[@value="更新"]`;

    // ボタンが存在するかチェック
    const isVisible = await page.isVisible(updateButtonSelector);

    if (isVisible) {
      logger.error(`Found update button for "${targetAccountName}". Clicking...`);
      
      // クリック実行
      await page.click(updateButtonSelector);

      // 更新ボタンは非同期（data-remote="true"）で動作するため、
      // ボタンが「更新中」の表示に変わる、または処理が受け付けられたことを確認
      logger.error(`Update request sent for "${targetAccountName}".`);
      
      // 必要に応じて、画面上の「更新中」スピナーが表示されるのを待機
      // await page.waitForSelector('span:has-text("更新中")', { timeout: 5000 }).catch(() => {});

    } else {
      logger.error(`Error: Account "${targetAccountName}" not found or update button is missing.`);
      // デバッグ用に現在の口座名をリストアップ
      const accounts = await page.$$eval('td.service a', els => els.map(el => el.innerText.trim()));
      logger.error("Available accounts:", accounts);
    }

  } catch (error) {
    logger.error("An error occurred during account update:", error);
    await page.screenshot({ path: "update-error.png" });
  } finally {
    // 通信が完了するのを少し待ってからクローズ
    await page.waitForTimeout(2000); 
    await browser.close();
  }
};

// コマンドライン引数から口座名を受け取る例: node accounts-update.js "楽天銀行@freddie"
if (require.main === module) {
  const accountName = process.argv[2];
  if (!accountName) {
    console.error("Please provide an account name. (e.g., node accounts-update.js \"PayPay\")");
    process.exit(1);
  }
  runAccountUpdate(accountName);
}

