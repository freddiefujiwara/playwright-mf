import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runAccountsUpdate } from '../accounts-update.js';
import { chromium } from 'playwright-extra';

vi.mock('puppeteer-extra-plugin-stealth', () => ({
  default: vi.fn(() => ({})),
}));

describe('accounts-update.js', () => {
  let mockPage, mockContext, mockBrowser, launchSpy, useSpy;

  beforeEach(() => {
    mockPage = {
      goto: vi.fn().mockResolvedValue(undefined),
      isVisible: vi.fn().mockResolvedValue(true),
      click: vi.fn().mockResolvedValue(undefined),
      $$eval: vi.fn(),
      screenshot: vi.fn().mockResolvedValue(undefined),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    };
    mockContext = {
      newPage: vi.fn().mockResolvedValue(mockPage),
    };
    mockBrowser = {
      newContext: vi.fn().mockResolvedValue(mockContext),
      close: vi.fn().mockResolvedValue(undefined),
    };

    launchSpy = vi.spyOn(chromium, 'launch').mockResolvedValue(mockBrowser);
    useSpy = vi.spyOn(chromium, 'use').mockImplementation(() => {});

    // Mock console to avoid cluttering test output
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should update a single account successfully', async () => {
    const logger = { error: vi.fn() };
    const targetAccountName = 'Test Account';

    await runAccountsUpdate(targetAccountName, { logger });

    expect(useSpy).toHaveBeenCalled();
    expect(launchSpy).toHaveBeenCalledWith({ headless: true });
    expect(mockPage.goto).toHaveBeenCalledWith('https://moneyforward.com/accounts', {
      waitUntil: 'domcontentloaded',
    });

    const expectedSelector = `//tr[descendant::a[text()="${targetAccountName}"]]//input[@value="更新"]`;
    expect(mockPage.isVisible).toHaveBeenCalledWith(expectedSelector);
    expect(mockPage.click).toHaveBeenCalledWith(expectedSelector);
    expect(logger.error).toHaveBeenCalledWith(`Updating "${targetAccountName}"...`);
    expect(logger.error).toHaveBeenCalledWith(`Update request sent for "${targetAccountName}".`);
    expect(mockPage.waitForTimeout).toHaveBeenCalledWith(2000);
    expect(mockBrowser.close).toHaveBeenCalled();
  });

  it('should update multiple accounts successfully', async () => {
    const logger = { error: vi.fn() };
    const targetAccountNames = ['Account 1', 'Account 2'];

    await runAccountsUpdate(targetAccountNames, { logger });

    expect(mockPage.click).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith('Updating "Account 1"...');
    expect(logger.error).toHaveBeenCalledWith('Updating "Account 2"...');
  });

  it('should update all accounts when no names are specified', async () => {
    const logger = { error: vi.fn() };
    const mockAccounts = ['Account A', 'Account B'];

    mockPage.$$eval.mockImplementation(async (selector, fn) => {
      // Simulate $$eval behavior for 'tr'
      const rows = mockAccounts.map(name => ({
        querySelector: (sel) => {
          if (sel === 'td.service a') return { innerText: name.trim() };
          if (sel === 'input[value="更新"]') return {};
          return null;
        }
      }));
      return fn(rows);
    });

    await runAccountsUpdate([], { logger });

    expect(logger.error).toHaveBeenCalledWith(`Found ${mockAccounts.length} updateable accounts.`);
    expect(mockPage.click).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith('Updating "Account A"...');
    expect(logger.error).toHaveBeenCalledWith('Updating "Account B"...');
  });

  it('should filter out rows without update buttons when updating all', async () => {
    const logger = { error: vi.fn() };
    const mockRows = [
      { name: 'Account A', hasButton: true },
      { name: 'Account B', hasButton: false },
      { name: 'No Name', hasButton: true, noName: true },
    ];

    mockPage.$$eval.mockImplementation(async (selector, fn) => {
      const rows = mockRows.map(row => ({
        querySelector: (sel) => {
          if (sel === 'td.service a') return row.noName ? null : { innerText: row.name };
          if (sel === 'input[value="更新"]') return row.hasButton ? {} : null;
          return null;
        }
      }));
      return fn(rows);
    });

    await runAccountsUpdate([], { logger });

    expect(logger.error).toHaveBeenCalledWith(`Found 1 updateable accounts.`);
    expect(mockPage.click).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith('Updating "Account A"...');
  });

  it('should handle a single string as targetAccountNames', async () => {
    const logger = { error: vi.fn() };
    const targetAccountName = 'Single Account';

    await runAccountsUpdate(targetAccountName, { logger });

    expect(mockPage.click).toHaveBeenCalledWith(expect.stringContaining(targetAccountName));
  });

  it('should log error when account is not found', async () => {
    const logger = { error: vi.fn() };
    const targetAccountName = 'Non Existent Account';
    mockPage.isVisible.mockResolvedValue(false);

    await runAccountsUpdate([targetAccountName], { logger });

    expect(mockPage.isVisible).toHaveBeenCalled();
    expect(mockPage.click).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(`Skipping "${targetAccountName}": Update button not found.`);
  });

  it('should handle errors and take a screenshot', async () => {
    const logger = { error: vi.fn() };
    const targetAccountName = 'Test Account';
    const error = new Error('Navigation failed');
    mockPage.goto.mockRejectedValue(error);

    await runAccountsUpdate(targetAccountName, { logger });

    expect(logger.error).toHaveBeenCalledWith('An error occurred during accounts update:', error);
    expect(mockPage.screenshot).toHaveBeenCalledWith({ path: 'accounts-update-error.png' });
    expect(mockPage.waitForTimeout).toHaveBeenCalledWith(2000);
    expect(mockBrowser.close).toHaveBeenCalled();
  });

  it('should work with default parameters', async () => {
    const targetAccountName = 'Test Account';
    // When no logger is passed, it uses console.error which we spied on
    await runAccountsUpdate(targetAccountName);
    expect(console.error).toHaveBeenCalled();
    expect(mockBrowser.close).toHaveBeenCalled();
  });
});
