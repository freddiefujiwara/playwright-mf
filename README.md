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

## Output files

- The JSON is **printed to the terminal**.
  - You can save it to a file like this:

    ```bash
    node bs-portfolio.js > output.json
    ```

- On error, the script saves a screenshot here:

```
./debug-error.png
```

## Troubleshooting

- If `auth.json` is missing or expired, run `node auth.js` again.
- If login fails or the script does not work, try running `node auth.js` again or delete `~/.config/playwright-mf/auth.json` and re-login.
- If the page layout changes, selectors may fail and you may get an error screenshot.

## Security

`auth.json` contains your login session. Do not share it.
