import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getAuthPaths, registerStealth, runCfScrape, normalizeCfResult, parseDisplayedMonthTitle, parseTargetMonth, findOutOfMonthTransactions } from '../cf.js';
// Import the actual chromium object to spy on it
import { chromium } from 'playwright-extra';
import path from 'path';
import os from 'os';
import { withDom } from './helpers/dom.mjs';

// We only need to mock the stealth plugin, as we will spy on chromium methods directly.
vi.mock('puppeteer-extra-plugin-stealth', () => ({
  default: vi.fn(() => ({})),
}));

describe('cf.js', () => {
  beforeEach(() => {
    // Mock console functions for clean test output
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore all mocks and spies
    vi.restoreAllMocks();
  });

  describe('getAuthPaths', () => {
    it('should return the correct auth path', () => {
      const homedir = '/home/user';
      vi.spyOn(os, 'homedir').mockReturnValue(homedir);
      const { authPath } = getAuthPaths({ env: {} });
      expect(authPath).toBe(path.join(homedir, '.config', 'playwright-mf', 'auth.json'));
    });
  });

  describe('registerStealth', () => {
    it('should register the stealth plugin', () => {
      const use = vi.fn();
      const chromiumModule = { use };
      const plugin = {};
      registerStealth(chromiumModule, plugin);
      expect(use).toHaveBeenCalledWith(plugin);
    });
  });

  describe('normalizeCfResult', () => {
    it('should normalize transactions correctly', () => {
      const raw = {
        timestamp: '2023-01-01T00:00:00.000Z',
        transactions: [
          {
            date: ' 01/01 ',
            content: ' Test Transaction ',
            amount_text: ' -1,000円 ',
            account: ' Test Bank ',
            category_main: ' Main ',
            category_sub: ' Sub ',
            memo: ' Memo ',
            is_transfer: false,
          },
          {
            date: '01/02',
            content: 'Transfer',
            amount_text: '-500円',
            account: 'Bank A',
            category_main: 'Transfer',
            category_sub: 'Out',
            memo: '',
            is_transfer: true,
          },
        ],
      };
      const expected = {
        timestamp: '2023-01-01T00:00:00.000Z',
        transactions: [
          {
            date: '01/01',
            content: 'Test Transaction',
            amount_yen: -1000,
            account: 'Test Bank',
            category_main: 'Main',
            category_sub: 'Sub',
            memo: 'Memo',
            is_transfer: false,
          },
          {
            date: '01/02',
            content: 'Transfer',
            amount_yen: -500,
            account: 'Bank A',
            category_main: 'Transfer',
            category_sub: 'Out',
            memo: '',
            is_transfer: true,
          },
        ],
      };
      const result = normalizeCfResult(raw);
      expect(result).toEqual(expected);
    });

    it('should filter out transactions with no content', () => {
      const raw = {
        timestamp: '2023-01-01T00:00:00.000Z',
        transactions: [
          {
            date: '01/01',
            content: 'Valid',
            amount_text: '-1,000円',
            account: 'Test Bank',
            category_main: 'Main',
            category_sub: 'Sub',
            memo: 'Memo',
            is_transfer: false,
          },
          {
            date: '01/02',
            content: ' ',
            amount_text: '-500円',
            account: 'Bank A',
            category_main: 'Transfer',
            category_sub: 'Out',
            memo: '',
            is_transfer: true,
          },
          {
            date: '01/03',
            content: '',
            amount_text: '-200円',
            account: 'Bank B',
            category_main: 'Etc',
            category_sub: 'Etc',
            memo: '',
            is_transfer: false,
          },
        ],
      };
      const result = normalizeCfResult(raw);
      expect(result.transactions.length).toBe(1);
      expect(result.transactions[0].content).toBe('Valid');
    });

    it('should handle empty transactions array', () => {
      const raw = {
        timestamp: '2023-01-01T00:00:00.000Z',
        transactions: [],
      };
      const result = normalizeCfResult(raw);
      expect(result.transactions).toEqual([]);
    });
  });

  describe('runCfScrape', () => {
    let mockPage, mockContext, mockBrowser, launchSpy;

    beforeEach(() => {
      // Set up the full mock hierarchy for a playwright browser session
      mockPage = {
        goto: vi.fn().mockResolvedValue(undefined),
        waitForSelector: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn(),
        screenshot: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockResolvedValue(undefined),
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
      };
      mockContext = {
        newPage: vi.fn().mockResolvedValue(mockPage),
      };
      mockBrowser = {
        newContext: vi.fn().mockResolvedValue(mockContext),
        close: vi.fn().mockResolvedValue(undefined),
      };

      // Spy on `chromium.launch` and replace its implementation with one that returns our mock browser
      launchSpy = vi.spyOn(chromium, 'launch').mockResolvedValue(mockBrowser);
    });

    it('should scrape data successfully', async () => {
      const html = `
        <table id="cf-detail-table">
          <tbody class="list_body">
            <tr class="transaction_list">
              <td class="date"><span>01/01</span></td>
              <td class="content"><div><span>Test Transaction</span></div></td>
              <td class="amount"><span class="offset">-1,000円</span></td>
              <td class="note calc" title="Test Bank"></td>
              <td class="lctg"><span class="v_l_ctg">Main</span></td>
              <td class="mctg"><span class="v_m_ctg">Sub</span></td>
              <td class="memo"><span class="noform"><span>Memo</span></span></td>
            </tr>
            <tr class="transaction_list mf-grayout">
              <td class="date"><span>01/02</span></td>
              <td class="content"><div><span>Transfer</span></div></td>
              <td class="amount"><span class="offset">-500円</span></td>
              <td class="note calc" title="Bank A"></td>
              <td class="lctg"><span class="v_l_ctg">Transfer</span></td>
              <td class="mctg"><span class="v_m_ctg">Out</span></td>
              <td class="memo"><span class="noform"><span></span></span></td>
            </tr>
          </tbody>
        </table>
      `;
      const expected = {
        transactions: [
          {
            date: '01/01',
            content: 'Test Transaction',
            amount_yen: -1000,
            account: 'Test Bank',
            category_main: 'Main',
            category_sub: 'Sub',
            memo: 'Memo',
            is_transfer: false,
          },
          {
            date: '01/02',
            content: 'Transfer',
            amount_yen: -500,
            account: 'Bank A',
            category_main: 'Transfer',
            category_sub: 'Out',
            memo: '',
            is_transfer: true,
          },
        ],
      };
      mockPage.evaluate.mockImplementation((fn) => withDom(html, () => fn()));

      await runCfScrape();

      expect(launchSpy).toHaveBeenCalledWith({ headless: true });
      expect(mockBrowser.newContext).toHaveBeenCalled();
      expect(mockContext.newPage).toHaveBeenCalled();
      expect(mockPage.goto).toHaveBeenCalledWith('https://moneyforward.com/cf', { waitUntil: 'domcontentloaded' });
      expect(mockPage.waitForSelector).toHaveBeenCalledWith('#cf-detail-table', { timeout: 30000 });
      expect(mockPage.waitForSelector).toHaveBeenCalledWith(
        '#cf-detail-table tbody.list_body tr.transaction_list',
        { timeout: 30000 }
      );
      expect(mockPage.evaluate).toHaveBeenCalled();
      const logged = JSON.parse(console.log.mock.calls[0][0]);
      expect(logged.timestamp).toEqual(expect.any(String));
      expect(logged).toEqual(expect.objectContaining(expected));
      expect(console.error).toHaveBeenCalledWith('Accessing transactions page...');
      expect(console.error).toHaveBeenCalledWith(`Scraping complete: Extracted ${expected.transactions.length} transactions.`);
      expect(mockBrowser.close).toHaveBeenCalled();
      expect(mockPage.screenshot).not.toHaveBeenCalled();
    });

    it('should handle errors during scraping', async () => {
      const error = new Error('Failed to load page');
      mockPage.goto.mockRejectedValue(error);

      await runCfScrape();

      expect(launchSpy).toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith('An error occurred:', error);
      expect(mockPage.screenshot).toHaveBeenCalledWith({ path: 'cf-error.png' });
      expect(mockBrowser.close).toHaveBeenCalled();
    });

    it('should navigate back and then back to today when prevMonths is specified', async () => {
      const html = `
        <table id="cf-detail-table">
          <tbody class="list_body">
            <tr class="transaction_list">
              <td class="date"><span>01/01</span></td>
              <td class="content"><div><span>Test</span></div></td>
              <td class="amount"><span class="offset">100円</span></td>
            </tr>
          </tbody>
        </table>
      `;
      mockPage.evaluate.mockImplementation((fn) => withDom(html, () => fn()));

      await runCfScrape({ prevMonths: 2 });

      expect(mockPage.click).toHaveBeenCalledTimes(3); // 2 prev + 1 today
      expect(mockPage.click.mock.calls[0][0]).toBe(
        'button.fc-button-prev.spec-fc-button-click-attached:not(.fc-state-disabled)'
      );
      expect(mockPage.click.mock.calls[0][1]).toEqual({ timeout: 30000 });
      expect(mockPage.click.mock.calls[1][0]).toBe(
        'button.fc-button-prev.spec-fc-button-click-attached:not(.fc-state-disabled)'
      );
      expect(mockPage.click.mock.calls[1][1]).toEqual({ timeout: 30000 });
      expect(mockPage.click.mock.calls[2]).toEqual(['.fc-button-today']);

      expect(mockPage.waitForLoadState).toHaveBeenCalledWith('networkidle', { timeout: 10000 });
      expect(mockPage.waitForLoadState).toHaveBeenCalledTimes(3);

      expect(mockPage.waitForSelector).toHaveBeenCalledWith('#cf-detail-table', { timeout: 30000 });

      expect(console.error).toHaveBeenCalledWith('Moving back 2 month(s)...');
      expect(console.error).toHaveBeenCalledWith('Returning to current month...');
    });

    it('should navigate to a target month and verify the rows', async () => {
      mockPage.waitForTimeout = vi.fn().mockResolvedValue(undefined);
      let title = '2026/11/1 - 2026/11/30';
      mockPage.evaluate.mockImplementation(async (fn, arg) => {
        if (arg === '.fc-header-title h2') return title;
        if (fn.toString().includes('querySelectorAll')) {
          return {
            timestamp: '2026-11-09T00:00:00.000Z',
            transactions: [
              {
                date: '10/05',
                content: 'Oct Tx',
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
        return 10; // first row already belongs to October
      });
      mockPage.click.mockImplementation(async (selector) => {
        if (selector.includes('fc-button-prev')) {
          title = '2026/10/1 - 2026/10/31';
        }
      });

      await runCfScrape({ targetMonth: '2026-10' });

      const prevClicks = mockPage.click.mock.calls.filter(([s]) => s.includes('fc-button-prev'));
      expect(prevClicks.length).toBe(1);
      const logged = JSON.parse(console.log.mock.calls[0][0]);
      expect(logged.transactions.length).toBe(1);
      expect(logged.transactions[0].date).toBe('10/05');
      expect(console.error).toHaveBeenCalledWith(
        'Verified: all 1 transactions belong to 2026-10.'
      );
    });

    it('should fail loudly when rows fall outside the target month', async () => {
      mockPage.waitForTimeout = vi.fn().mockResolvedValue(undefined);
      mockPage.evaluate.mockImplementation(async (fn, arg) => {
        if (arg === '.fc-header-title h2') return '2026/10/1 - 2026/10/31';
        if (fn.toString().includes('querySelectorAll')) {
          return {
            timestamp: '2026-11-09T00:00:00.000Z',
            transactions: [
              {
                date: '11/01',
                content: 'Wrong month',
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
        return 11; // first row is stuck in November
      });

      await expect(runCfScrape({ targetMonth: '2026-10' })).rejects.toThrow(
        /outside 2026-10/
      );
      expect(console.log).not.toHaveBeenCalled();
    });

    it('should fail loudly when the calendar never reaches the target month', async () => {
      mockPage.waitForTimeout = vi.fn().mockResolvedValue(undefined);
      mockPage.evaluate.mockImplementation(async (fn, arg) => {
        if (arg === '.fc-header-title h2') return '2026/11/1 - 2026/11/30';
        return { timestamp: '2026-11-09T00:00:00.000Z', transactions: [] };
      });

      await expect(runCfScrape({ targetMonth: '2026-10' })).rejects.toThrow(
        /Timed out waiting for the calendar month title/
      );
      expect(console.log).not.toHaveBeenCalled();
    });

    it('should wait out a Loading... header while navigating', async () => {
      mockPage.waitForTimeout = vi.fn().mockResolvedValue(undefined);
      let titleReads = 0;
      mockPage.evaluate.mockImplementation(async (fn, arg) => {
        if (arg === '.fc-header-title h2') {
          titleReads += 1;
          // After the click: "Loading..." twice, then October settles.
          if (titleReads <= 1) return '2026/11/1 - 2026/11/30';
          if (titleReads <= 3) return 'Loading...';
          return '2026/10/1 - 2026/10/31';
        }
        if (fn.toString().includes('querySelectorAll')) {
          return {
            timestamp: '2026-11-09T00:00:00.000Z',
            transactions: [
              {
                date: '10/05',
                content: 'Oct Tx',
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
        return 10;
      });
      mockPage.click.mockResolvedValue(undefined);

      await runCfScrape({ targetMonth: '2026-10' });

      const prevClicks = mockPage.click.mock.calls.filter(([s]) => s.includes('fc-button-prev'));
      expect(prevClicks.length).toBe(1);
      expect(console.error).toHaveBeenCalledWith(
        'Verified: all 1 transactions belong to 2026-10.'
      );
    });
  });

  describe('parseDisplayedMonthTitle', () => {
    it('parses the range start', () => {
      expect(parseDisplayedMonthTitle('2026/11/1 - 2026/11/30')).toEqual({ year: 2026, month: 11 });
      expect(parseDisplayedMonthTitle('2026/9/1 - 2026/9/30')).toEqual({ year: 2026, month: 9 });
    });

    it('returns null for unrelated text', () => {
      expect(parseDisplayedMonthTitle('2026年11月9日')).toBeNull();
      expect(parseDisplayedMonthTitle('')).toBeNull();
      expect(parseDisplayedMonthTitle(undefined)).toBeNull();
    });
  });

  describe('parseTargetMonth', () => {
    it('parses YYYY-MM strings', () => {
      expect(parseTargetMonth('2026-09')).toEqual({ year: 2026, month: 9 });
      expect(parseTargetMonth('2026-12')).toEqual({ year: 2026, month: 12 });
    });

    it('accepts { year, month } objects', () => {
      expect(parseTargetMonth({ year: 2026, month: 9 })).toEqual({ year: 2026, month: 9 });
    });

    it('rejects invalid values', () => {
      expect(parseTargetMonth('2026-13')).toBeNull();
      expect(parseTargetMonth('2026/09')).toBeNull();
      expect(parseTargetMonth(null)).toBeNull();
    });
  });

  describe('findOutOfMonthTransactions', () => {
    it('returns an empty list when every row belongs to the month', () => {
      const txs = [{ date: '09/01' }, { date: '09/30(水)' }];
      expect(findOutOfMonthTransactions(txs, { year: 2026, month: 9 })).toEqual([]);
    });

    it('returns the offending dates', () => {
      const txs = [{ date: '09/01' }, { date: '08/31(月)' }, { date: '10/01' }];
      expect(findOutOfMonthTransactions(txs, { year: 2026, month: 9 })).toEqual(['08/31(月)', '10/01']);
    });
  });
});
