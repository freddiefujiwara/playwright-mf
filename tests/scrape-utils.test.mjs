import { describe, expect, it, vi } from "vitest";

const { default: utils } = await import("../lib/scrape-utils.js");

const {
  normalizeWhitespace,
  buildHeaders,
  parsePercent,
  parseTableData,
  parseYen,
  pickFirst,
  getAuthPaths,
  buildContextOptions,
  registerStealth,
} = utils;

describe("scrape-utils", () => {
  it("normalizes whitespace", () => {
    expect(normalizeWhitespace("  foo\u00a0bar \n baz ")).toBe("foo bar\nbaz");
  });

  it("parses yen with full-width and negative markers", () => {
    expect(parseYen("１,２３４円")).toBe(1234);
    expect(parseYen("▲2,500円")).toBe(-2500);
    expect(parseYen("(3,000円)")).toBe(-3000);
  });

  it("parses percent", () => {
    expect(parsePercent("12.5%")).toBe(12.5);
  });

  it("builds headers from provided list and rows", () => {
    expect(buildHeaders(["A", "B"], [["1", "2"]])).toEqual(["A", "B"]);
    expect(buildHeaders([], [["1", "2"], ["3"]])).toEqual(["col_1", "col_2"]);
    expect(buildHeaders([], [])).toEqual([]);
  });

  it("parses tables with fallback headers", () => {
    const parsed = parseTableData({
      headers: [],
      rows: [
        ["A", "1", "変更"],
        ["B", "2", "削除"],
      ],
    });

    expect(parsed.headers).toEqual(["col_1", "col_2"]);
    expect(parsed.items).toEqual([
      { col_1: "A", col_2: "1" },
      { col_1: "B", col_2: "2" },
    ]);
  });

  it("picks the first regex match group", () => {
    expect(pickFirst("合計：1,234円", /合計：([0-9,]+円)/)).toBe("1,234円");
    expect(pickFirst("合計：1,234円", /存在しないパターン/)).toBe("");
    expect(pickFirst(null, /a/)).toBe("");
  });

  it("gets auth paths", () => {
    const homedir = () => "/home/user";
    const join = (...args) => args.join("/");
    const env = { PLAYWRIGHT_MF_AUTH_DIR: "/custom/dir" };

    const paths = getAuthPaths({ homedir, join, env });
    expect(paths.authDir).toBe("/custom/dir");
    expect(paths.authPath).toBe("/custom/dir/auth.json");

    const defaultPaths = getAuthPaths({ homedir, join, env: {} });
    expect(defaultPaths.authDir).toBe("/home/user/.config/playwright-mf");
    expect(defaultPaths.authPath).toBe("/home/user/.config/playwright-mf/auth.json");

    const customPath = getAuthPaths({ homedir, join, env: { PLAYWRIGHT_MF_AUTH_PATH: "/custom/auth.json" } });
    expect(customPath.authPath).toBe("/custom/auth.json");
  });

  it("builds context options", () => {
    const options = buildContextOptions("/path/to/auth.json");
    expect(options).toEqual({
      storageState: "/path/to/auth.json",
      viewport: { width: 1280, height: 800 },
    });
  });

  it("registers stealth", () => {
    const mockChromium = { use: vi.fn() };
    const mockStealth = { name: "stealth" };

    registerStealth(mockChromium, mockStealth);
    expect(mockChromium.use).toHaveBeenCalledWith(mockStealth);

    // Testing lazy require is a bit tricky, but we can check if it calls use at least
    const mockChromium2 = { use: vi.fn() };
    registerStealth(mockChromium2);
    expect(mockChromium2.use).toHaveBeenCalled();
  });
});
