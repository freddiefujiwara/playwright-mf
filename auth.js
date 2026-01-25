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
    logger.log(`Saved authentication data: ${authPath}`);
  } catch (err) {
    logger.error("Failed to save auth.json:", err);
  }
};

const runAuthFlow = async ({
  chromiumModule = chromium,
  stdin = process.stdin,
  logger = console,
  exit = process.exit,
  authPaths = getAuthPaths(),
  persistFn = persistAuthState,
} = {}) => {
  const browser = await chromiumModule.launch({ headless: false }); // Show browser
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("https://moneyforward.com/users/sign_in");

  logger.log("Please complete the login process in the browser.");
  logger.log("When you are done, please return to the terminal and press Enter...");

  // Workaround for environments where stdin stops
  stdin.resume();

  stdin.once("data", async () => {
    try {
      await persistFn({
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

/* c8 ignore next 3 */
if (require.main === module) {
  runAuthFlow();
}

module.exports = {
  getAuthPaths,
  persistAuthState,
  runAuthFlow,
};
