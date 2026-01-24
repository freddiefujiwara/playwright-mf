const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const os = require("os");

(async () => {
  const browser = await chromium.launch({ headless: false }); // ブラウザを表示
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("https://moneyforward.com/users/sign_in");

  console.log("ブラウザでログインを完了させてください。");
  console.log("完了したら、ターミナルに戻って Enter を押してください...");

  // 保存先: ~/.config/playwright-mf/auth.json
  const authDir = path.join(os.homedir(), ".config", "playwright-mf");
  const authPath = path.join(authDir, "auth.json");

  // stdin が止まる環境対策
  process.stdin.resume();

  process.stdin.once("data", async () => {
    try {
      // ディレクトリが無ければ作成
      fs.mkdirSync(authDir, { recursive: true });

      // 認証状態を保存
      await context.storageState({ path: authPath });

      console.log(`認証情報を保存しました: ${authPath}`);
    } catch (err) {
      console.error("auth.json の保存に失敗しました:", err);
    } finally {
      await browser.close();
      process.exit();
    }
  });
})();
