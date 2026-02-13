# Playwright MoneyForward Portfolio Export

This project logs in to MoneyForward and saves your login session.
Then it opens the portfolio page and prints your asset data as JSON.

## What you need

- Node.js (LTS is fine)
- npm
- A MoneyForward account

## Install

```bash
npm i
```

If Playwright browsers are not installed yet, run:

```bash
npx playwright install
```

On Linux, you might also need system dependencies:

```bash
sudo npx playwright install-deps
```

## Step 1: Login and save auth.json

Run this script first:

```bash
node auth.js
```

What happens:

- A Chromium browser opens.
- You log in on the MoneyForward login page.
- Go back to the terminal and press **Enter**.
- The script saves your login session to:

```
~/.config/playwright-mf/auth.json
```

Keep this file. The next script uses it.

## Step 2: Get portfolio data

After you have `auth.json`, run:

```bash
node bs-portfolio.js
```

What happens:

- The script opens the portfolio page in headless Chromium.
- It reads your asset summary and detail tables.
- It prints a JSON result to **stdout**.

Example output shape:

```json
{
  "timestamp": "2024-01-01T00:00:00.000Z",
  "breakdown": [
    {
      "category": "現金・預金",
      "amount_text": "1,000円",
      "amount_yen": 1000,
      "percentage_text": "10%",
      "percentage": 10
    }
  ],
  "assetClassRatio": [
    {
      "label": "現金・預金",
      "value": 10
    }
  ],
  "details": [
    {
      "id": "portfolio_det_1",
      "category": "現金・預金",
      "total_text": "1,000円",
      "total_yen": 1000,
      "tables": [
        {
          "headers": ["金融機関", "残高"],
          "items": [
            {
              "金融機関": "Example Bank",
              "残高": "1,000円"
            }
          ]
        }
      ]
    }
  ],
  "meta": {
    "breakdown": 1,
    "sections": 1,
    "rows": 1
  }
}
```

Notes:

- `breakdown` is the summary table at the top of the page.
- `details` contains each asset section and its tables.
- `assetClassRatio` is read from a page script, if present.

## Step 3: Get liability data

After you have `auth.json`, run:

```bash
node bs-liability.js
```

What happens:

- The script opens the liability page in headless Chromium.
- It reads the liability summary and detail tables.
- It prints a JSON result to **stdout**.

Example output shape:

```json
{
  "timestamp": "2024-01-01T00:00:00.000Z",
  "total": {
    "total_text": "1,234円",
    "total_yen": 1234
  },
  "breakdown": [
    {
      "category": "カード",
      "amount_text": "1,234円",
      "amount_yen": 1234,
      "percentage_text": "100%",
      "percentage": 100
    }
  ],
  "details": [
    {
      "id": "liability_det",
      "category": "負債詳細",
      "tables": [
        {
          "headers": ["金融機関", "残高"],
          "items": [
            {
              "金融機関": "Example Bank",
              "残高": "1,234円",
              "残高_yen": 1234
            }
          ]
        }
      ]
    }
  ],
  "meta": {
    "breakdown": 1,
    "sections": 1,
    "rows": 1
  }
}
```

Notes:

- `total` contains the liability total.
- `breakdown` is the summary table at the top of the page.
- `details` contains the detailed liability table with a `残高_yen` helper field.

## Step 4: Get cash flow (transaction) data

After you have `auth.json`, run:

```bash
node cf.js
```

What happens:

- The script opens the cash flow (入出金) page in headless Chromium.
- It reads the transaction table for the current month.
- It prints a JSON result to **stdout**.

You can also specify `-p <n>` to move back `n` months before extraction:

```bash
node cf.js -p 1
```

This will click the "Previous" button `n` times before extracting data, and then return to the current month by clicking the "Today" button.

Example output shape:
```json
{
  "timestamp": "2024-01-01T00:00:00.000Z",
  "transactions": [
    {
      "date": "01/27(火)",
      "content": "年会費",
      "amount_yen": -550,
      "account": "サンプルカード 1234",
      "category_main": "その他",
      "category_sub": "雑費",
      "memo": "",
      "is_transfer": false
    }
  ]
}
```

## Testing

This project uses `vitest` for testing.

To run all tests:

```bash
npx vitest run
```

To run tests with a coverage report:

```bash
npx vitest run --coverage
```

The tests mock network requests to avoid actual logins and scraping during test runs.

## Output files

- The JSON is **printed to the terminal**.
  - You can save it to a file like this:

    ```bash
    node bs-portfolio.js > output.json
    ```

- On error, the script saves a screenshot here:

```
./cf-error.png
```

## Troubleshooting

- If `auth.json` is missing or expired, run `node auth.js` again.
- If login fails or the script does not work, try running `node auth.js` again or delete `~/.config/playwright-mf/auth.json` and re-login.
- If the page layout changes, selectors may fail and you may get an error screenshot.

## Step 5: Update account data

To update specific accounts or all accounts, run:

```bash
node accounts-update.js "Account Name 1" "Account Name 2"
```

If you don't provide any account names, it will attempt to update all accounts:

```bash
node accounts-update.js
```

What happens:

- The script opens the accounts page in headless Chromium.
- It finds the "Update" (更新) button for the specified accounts (or all accounts).
- It clicks each button to trigger an update.

## Security

`auth.json` contains your login session. Do not share it.
