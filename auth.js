const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const os = require("os");

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

const persistAuthState = async ({
  context,
  authDir,
  authPath,
  fsModule = fs,
  logger = console,
} = {}) => {
  try {
    fsModule.mkdirSync(authDir, { recursive: true });
    await context.storageState({ path: authPath });
    logger.log(`認証情報を保存しました: ${authPath}`);
  } catch (err) {
    logger.error("auth.json の保存に失敗しました:", err);
  }
};

const runAuthFlow = async ({
  chromiumModule = chromium,
  stdin = process.stdin,
  logger = console,
  exit = process.exit,
  authPaths = getAuthPaths(),
} = {}) => {
  const browser = await chromiumModule.launch({ headless: false }); // ブラウザを表示
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("https://moneyforward.com/users/sign_in");

  logger.log("ブラウザでログインを完了させてください。");
  logger.log("完了したら、ターミナルに戻って Enter を押してください...");

  // stdin が止まる環境対策
  stdin.resume();

  stdin.once("data", async () => {
    try {
      await persistAuthState({
        context,
        authDir: authPaths.authDir,
        authPath: authPaths.authPath,
        logger,
      });
    } finally {
      await browser.close();
      exit();
    }
  });
};

if (require.main === module) {
  runAuthFlow();
}

module.exports = {
  getAuthPaths,
  persistAuthState,
  runAuthFlow,
};
