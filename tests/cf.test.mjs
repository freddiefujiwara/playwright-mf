import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getAuthPaths, registerStealth, runCfScrape } from '../cf.js';
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
      const { authPath } = getAuthPaths();
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
        transactions: [{ content: 'Test Transaction', amount_yen: -1000 }],
      };
      mockPage.evaluate.mockResolvedValue(mockData);

      await runCfScrape();

      expect(launchSpy).toHaveBeenCalledWith({ headless: true });
      expect(mockBrowser.newContext).toHaveBeenCalled();
      expect(mockContext.newPage).toHaveBeenCalled();
      expect(mockPage.goto).toHaveBeenCalledWith('https://moneyforward.com/cf', { waitUntil: 'networkidle' });
      expect(mockPage.waitForSelector).toHaveBeenCalledWith('#cf-detail-table', { timeout: 30000 });
      expect(mockPage.evaluate).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(JSON.stringify(mockData, null, 2));
      expect(console.error).toHaveBeenCalledWith('入出金ページにアクセス中...');
      expect(console.error).toHaveBeenCalledWith(`取得完了: ${mockData.transactions.length} 件の明細を抽出しました。`);
      expect(mockBrowser.close).toHaveBeenCalled();
      expect(mockPage.screenshot).not.toHaveBeenCalled();
    });

    it('should handle errors during scraping', async () => {
      const error = new Error('Failed to load page');
      mockPage.goto.mockRejectedValue(error);

      await runCfScrape();

      expect(launchSpy).toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith('エラーが発生しました:', error);
      expect(mockPage.screenshot).toHaveBeenCalledWith({ path: 'cf-error.png' });
      expect(mockBrowser.close).toHaveBeenCalled();
    });
  });
});
