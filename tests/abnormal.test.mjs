import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  findOutOfMonthTransactions,
  navigateToTargetMonth,
  normalizeCfResult,
  parseDisplayedMonthTitle,
  parseTargetMonth,
  runCfScrape,
  waitForDisplayedMonth,
} from '../cf.js';
import { chromium } from 'playwright-extra';

// Abnormal-case tests: the "input from outside" for this repo is the
// scraped Money Forward page — its calendar heading, its table rows and
// the text inside amount cells. All fixtures are synthetic.

vi.mock('puppeteer-extra-plugin-stealth', () => ({
  default: vi.fn(() => ({})),
}));

const TITLE_SELECTOR = '.fc-header-title h2';

// A fake page whose calendar header always shows `title`.
const pageWithTitle = (title) => ({
  evaluate: vi.fn(async (fn, arg) => (arg === TITLE_SELECTOR ? title : undefined)),
  waitForTimeout: vi.fn().mockResolvedValue(undefined),
  click: vi.fn().mockResolvedValue(undefined),
});

describe('parseDisplayedMonthTitle — garbled headings must not parse as a month', () => {
  it('rejects month 13 and month 0', () => {
    expect(parseDisplayedMonthTitle('2026/13/1 - 2026/13/31')).toBeNull();
    expect(parseDisplayedMonthTitle('2026/00/10 - 2026/00/31')).toBeNull();
  });

  it('rejects a range start that is not a real date', () => {
    expect(parseDisplayedMonthTitle('2026/02/30 - 2026/03/30')).toBeNull();
    expect(parseDisplayedMonthTitle('2026/02/29 - 2026/03/31')).toBeNull(); // 2026 is not a leap year
    expect(parseDisplayedMonthTitle('2026/04/31 - 2026/05/31')).toBeNull();
    expect(parseDisplayedMonthTitle('2026/11/00 - 2026/11/30')).toBeNull();
    expect(parseDisplayedMonthTitle('2026/11/99 - 2026/12/99')).toBeNull();
  });

  it('still parses real range starts, including a leap day', () => {
    expect(parseDisplayedMonthTitle('2028/02/29 - 2028/03/31')).toEqual({ year: 2028, month: 2 });
    expect(parseDisplayedMonthTitle('2026/11/1 - 2026/11/30')).toEqual({ year: 2026, month: 11 });
  });
});

describe('waitForDisplayedMonth / navigateToTargetMonth — a garbled header never passes', () => {
  it('times out instead of accepting month 13 as January of the next year', async () => {
    // monthIndex({2026, 13}) collides with monthIndex({2027, 1}); before
    // the fix, navigation to 2027-01 "succeeded" on this garbage header.
    const page = pageWithTitle('2026/13/1 - 2026/13/31');
    await expect(navigateToTargetMonth(page, { year: 2027, month: 1 })).rejects.toThrow(
      /Timed out waiting for the calendar month title/
    );
  });

  it('times out on a header showing a non-existent date', async () => {
    const page = pageWithTitle('2026/02/30 - 2026/03/30');
    await expect(waitForDisplayedMonth(page)).rejects.toThrow(
      /Timed out waiting for the calendar month title/
    );
  });

  it('times out when the header never moves off the previous month (stale page)', async () => {
    const page = pageWithTitle('2026/11/1 - 2026/11/30');
    await expect(
      navigateToTargetMonth(page, { year: 2026, month: 10 })
    ).rejects.toThrow(/Timed out waiting for the calendar month title/);
  });
});

describe('findOutOfMonthTransactions — non-existent days must trip validation', () => {
  const t = { year: 2026, month: 2 };
  it('flags Feb 30 and Feb 29 of a non-leap year', () => {
    expect(findOutOfMonthTransactions([{ date: '02/30' }], t)).toEqual(['02/30']);
    expect(findOutOfMonthTransactions([{ date: '02/29' }], t)).toEqual(['02/29']);
  });

  it('accepts Feb 29 of a leap year', () => {
    expect(findOutOfMonthTransactions([{ date: '02/29' }], { year: 2028, month: 2 })).toEqual([]);
  });

  it('flags day 31 of a 30-day month, day 00 and day 32', () => {
    expect(findOutOfMonthTransactions([{ date: '09/31' }], { year: 2026, month: 9 })).toEqual(['09/31']);
    expect(findOutOfMonthTransactions([{ date: '04/31' }], { year: 2026, month: 4 })).toEqual(['04/31']);
    expect(findOutOfMonthTransactions([{ date: '09/00' }], { year: 2026, month: 9 })).toEqual(['09/00']);
    expect(findOutOfMonthTransactions([{ date: '01/32' }], { year: 2026, month: 1 })).toEqual(['01/32']);
  });

  it('still flags previous/next month bleed and unparseable dates', () => {
    const txs = [{ date: '01/31(土)' }, { date: '03/01' }, { date: '' }, { date: 'garbage' }, {}];
    expect(findOutOfMonthTransactions(txs, t)).toEqual(['01/31(土)', '03/01', '', 'garbage', undefined]);
  });
});

describe('parseTargetMonth — invalid --month values are rejected (pins)', () => {
  it('rejects out-of-range and malformed values', () => {
    for (const bad of ['2026-13', '2026-00', '2026-02-30', 'garbage', '', '2026/09', '2026-9-1', 202609, NaN]) {
      expect(parseTargetMonth(bad)).toBeNull();
    }
    expect(parseTargetMonth(null)).toBeNull();
    expect(parseTargetMonth(undefined)).toBeNull();
    expect(parseTargetMonth({ year: 2026, month: 13 })).toBeNull();
    expect(parseTargetMonth({ year: 2026, month: 0 })).toBeNull();
    expect(parseTargetMonth({ year: 2026, month: 2.5 })).toBeNull();
  });
});

describe('runCfScrape — a non-existent row date fails the verified scrape loudly', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects when a February scrape contains a 02/30 row', async () => {
    const mockPage = {
      goto: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockResolvedValue(undefined),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockResolvedValue(undefined),
      screenshot: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn(async (fn, arg) => {
        if (arg === TITLE_SELECTOR) return '2026/2/1 - 2026/2/28';
        if (fn.toString().includes('querySelectorAll')) {
          return {
            timestamp: '2026-11-09T00:00:00.000Z',
            transactions: [
              {
                date: '02/30',
                content: 'Impossible day',
                amount_text: '-100円',
                account: 'Bank',
                category_main: 'Main',
                category_sub: 'Sub',
                memo: '',
                is_transfer: false,
              },
            ],
          };
        }
        return 2; // first row claims February
      }),
    };
    const mockContext = { newPage: vi.fn().mockResolvedValue(mockPage) };
    const mockBrowser = {
      newContext: vi.fn().mockResolvedValue(mockContext),
      close: vi.fn().mockResolvedValue(undefined),
    };
    vi.spyOn(chromium, 'launch').mockResolvedValue(mockBrowser);
    const logger = { log: vi.fn(), error: vi.fn() };

    await expect(
      runCfScrape({ targetMonth: '2026-02', logger })
    ).rejects.toThrow(/outside 2026-02/);
    expect(logger.log).not.toHaveBeenCalled();
  });
});

describe('normalizeCfResult — deformed row fields cannot crash the normalizer', () => {
  it('drops a row whose content is null instead of throwing', () => {
    const raw = {
      timestamp: '2026-11-09T00:00:00.000Z',
      transactions: [
        { date: '09/01', content: null, amount_text: '-100円', account: 'Bank', category_main: 'M', category_sub: 'S', memo: '', is_transfer: false },
        { date: '09/02', content: 'Valid', amount_text: '-200円', account: 'Bank', category_main: 'M', category_sub: 'S', memo: '', is_transfer: false },
      ],
    };
    const result = normalizeCfResult(raw);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].content).toBe('Valid');
  });

  it('reads a null amount as null yen and numeric text fields as text', () => {
    const raw = {
      timestamp: '2026-11-09T00:00:00.000Z',
      transactions: [
        { date: '09/01', content: 'Tx', amount_text: null, account: 42, category_main: 'M', category_sub: 'S', memo: null, is_transfer: false },
      ],
    };
    const result = normalizeCfResult(raw);
    expect(result.transactions[0].amount_yen).toBeNull();
    expect(result.transactions[0].account).toBe('42');
    expect(result.transactions[0].memo).toBe('');
  });
});
