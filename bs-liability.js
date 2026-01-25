// bs-liability.js
//
// MoneyForward「負債」ページを、bs-portfolio.js相当の形式でJSON化して出力します。
// - ~/.config/playwright-mf/auth.json を storageState として利用（ログイン済み前提）
// - breakdown（負債内訳）
// - total（負債総額）
// - details（負債詳細テーブル）
//
// Usage:
//   node bs-liability.js > liability.json
//
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

const runLiabilityScrape = async ({
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
    logger.error("負債ページにアクセス中...");
    await page.goto("https://moneyforward.com/bs/liability", {
      waitUntil: "domcontentloaded",
    });

    // 「負債総額」ボックス・「負債の内訳」テーブル・「負債詳細」テーブル
    await page.waitForSelector("#bs-liability section.bs-liability", {
      timeout: 30000,
    });
    await page.waitForSelector("#bs-liability .liability-summary table.table-bordered", {
      timeout: 30000,
    });
    await page.waitForSelector("#liability_det table.table-det", {
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

        // theadが無い/空のケースのフォールバック（tbodyの最初の行のtd数で推定）
        if (!headers.length) {
          const colCount =
            table.querySelectorAll("tbody tr:first-child td").length || 0;
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

      const data = {
        timestamp: new Date().toISOString(),
        total: {
          total_text: "",
          total_yen: null,
        },
        breakdown: [],
        details: [],
        meta: {},
      };

      // ===== total（負債総額） =====
      // HTML例: <div class="heading-radius-box">負債総額：12,684,157円</div>
      const totalBox = document.querySelector(
        "#bs-liability section.bs-liability .heading-radius-box"
      );
      const totalText = pickFirst(norm(totalBox?.innerText), /負債総額：\s*([0-9,]+円)/);
      data.total.total_text = totalText;
      data.total.total_yen = parseYen(totalText);

      // ===== breakdown（負債の内訳） =====
      // HTML例: <div class="liability-summary">... <table class="table table-bordered"> <tr> <th>...<a>種類</a> <td>金額</td><td>%</td> </th> </tr>
      const summaryTable = document.querySelector(
        "#bs-liability .liability-summary section.bs-total-assets table.table-bordered"
      );
      if (summaryTable) {
        summaryTable.querySelectorAll("tr").forEach((tr) => {
          const th = tr.querySelector("th");
          const tds = tr.querySelectorAll("td");
          const category =
            norm(th?.querySelector("a")?.innerText) || norm(th?.innerText);

          if (!category) return;

          const amountText = norm(tds[0]?.innerText);
          const pctText = norm(tds[1]?.innerText);

          data.breakdown.push({
            category,
            amount_text: amountText,
            amount_yen: parseYen(amountText),
            percentage_text: pctText,
            percentage: parsePercent(pctText),
          });
        });
      }

      // ===== details（負債詳細） =====
      // #liability_det table.table-det を parseTable しつつ、残高列の数値も付与
      const detTable = document.querySelector("#liability_det table.table-det");
      if (detTable) {
        const parsed = parseTable(detTable);

        // 便利フィールドとして、残高（円）を同時に数値化して追加（列名が「残高」の想定）
        const items = parsed.items.map((row) => {
          const balanceText = row["残高"] ?? row["col_3"] ?? "";
          return {
            ...row,
            残高_yen: parseYen(balanceText),
          };
        });

        data.details.push({
          id: "liability_det",
          category: norm(document.querySelector("#liability_det h1.heading-normal")?.innerText) || "負債詳細",
          tables: [{ ...parsed, items }],
        });
      }

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

    logger.log(JSON.stringify(result, null, 2));

    logger.error("データ取得完了");
    logger.error(
      `breakdown=${result.meta.breakdown}, sections=${result.meta.sections}, rows=${result.meta.rows}`
    );
  } catch (error) {
    logger.error("エラー:", error);
    await page.screenshot({ path: "debug-error.png", fullPage: true });
  } finally {
    await browser.close();
  }
};

/* c8 ignore next 3 */
if (require.main === module) {
  runLiabilityScrape();
}

module.exports = {
  buildContextOptions,
  getAuthPaths,
  registerStealth,
  runLiabilityScrape,
};
