import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runAccountUpdate } from '../account-update.js';
import { chromium } from 'playwright-extra';

vi.mock('puppeteer-extra-plugin-stealth', () => ({
  default: vi.fn(() => ({})),
}));

describe('account-update.js', () => {
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

  it('should update account successfully when button is found', async () => {
    const logger = { error: vi.fn() };
    const targetAccountName = 'Test Account';

    await runAccountUpdate(targetAccountName, { logger });

    expect(useSpy).toHaveBeenCalled();
    expect(launchSpy).toHaveBeenCalledWith({ headless: true });
    expect(mockPage.goto).toHaveBeenCalledWith('https://moneyforward.com/accounts', {
      waitUntil: 'domcontentloaded',
    });

    const expectedSelector = `//tr[descendant::a[text()="${targetAccountName}"]]//input[@value="更新"]`;
    expect(mockPage.isVisible).toHaveBeenCalledWith(expectedSelector);
    expect(mockPage.click).toHaveBeenCalledWith(expectedSelector);
    expect(logger.error).toHaveBeenCalledWith(`Found update button for "${targetAccountName}". Clicking...`);
    expect(logger.error).toHaveBeenCalledWith(`Update request sent for "${targetAccountName}".`);
    expect(mockPage.waitForTimeout).toHaveBeenCalledWith(2000);
    expect(mockBrowser.close).toHaveBeenCalled();
  });

  it('should log error when account is not found', async () => {
    const logger = { error: vi.fn() };
    const targetAccountName = 'Non Existent Account';
    mockPage.isVisible.mockResolvedValue(false);

    const mockAccounts = ['Account 1', 'Account 2'];
    mockPage.$$eval.mockImplementation(async (selector, fn) => {
      // In a real browser, this fn runs in the browser context.
      // We simulate its behavior here.
      const els = mockAccounts.map(text => ({ innerText: text }));
      return fn(els);
    });

    await runAccountUpdate(targetAccountName, { logger });

    expect(mockPage.isVisible).toHaveBeenCalled();
    expect(mockPage.click).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(`Error: Account "${targetAccountName}" not found or update button is missing.`);
    expect(logger.error).toHaveBeenCalledWith('Available accounts:', mockAccounts);
    expect(mockPage.waitForTimeout).toHaveBeenCalledWith(2000);
    expect(mockBrowser.close).toHaveBeenCalled();
  });

  it('should handle errors and take a screenshot', async () => {
    const logger = { error: vi.fn() };
    const targetAccountName = 'Test Account';
    const error = new Error('Navigation failed');
    mockPage.goto.mockRejectedValue(error);

    await runAccountUpdate(targetAccountName, { logger });

    expect(logger.error).toHaveBeenCalledWith('An error occurred during account update:', error);
    expect(mockPage.screenshot).toHaveBeenCalledWith({ path: 'update-error.png' });
    expect(mockPage.waitForTimeout).toHaveBeenCalledWith(2000);
    expect(mockBrowser.close).toHaveBeenCalled();
  });

  it('should work with default parameters', async () => {
    const targetAccountName = 'Test Account';
    // When no logger is passed, it uses console.error which we spied on
    await runAccountUpdate(targetAccountName);
    expect(console.error).toHaveBeenCalled();
    expect(mockBrowser.close).toHaveBeenCalled();
  });
});
