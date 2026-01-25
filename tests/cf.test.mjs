import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getAuthPaths, registerStealth, runCfScrape, normalizeCfResult } from '../cf.js';
// Import the actual chromium object to spy on it
import { chromium } from 'playwright-extra';
import path from 'path';
import os from 'os';

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
      const mockData = {
        timestamp: '2023-01-01T00:00:00.000Z',
        transactions: [
          {
            date: '01/01',
            content: 'Test Transaction',
            amount_text: '-1,000円',
            account: 'Test Bank',
            category_main: 'Main',
            category_sub: 'Sub',
            memo: 'Memo',
            is_transfer: false,
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
        ],
      };
      mockPage.evaluate.mockResolvedValue(mockData);

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
      expect(console.log).toHaveBeenCalledWith(JSON.stringify(expected, null, 2));
      expect(console.error).toHaveBeenCalledWith('Accessing transactions page...');
      expect(console.error).toHaveBeenCalledWith(`Scraping complete: Extracted ${mockData.transactions.length} transactions.`);
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
  });
});
