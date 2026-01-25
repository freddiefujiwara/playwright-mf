import { describe, expect, it } from "vitest";

const { default: utils } = await import("../lib/scrape-utils.js");

const {
  normalizeWhitespace,
  parsePercent,
  parseTableData,
  parseYen,
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
});
