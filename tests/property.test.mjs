import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import {
  findOutOfMonthTransactions,
  navigateToTargetMonth,
  normalizeCfResult,
  parseDisplayedMonthTitle,
  parseTargetMonth,
} from '../cf.js';

const { default: utils } = await import('../lib/scrape-utils.js');
const { parsePercent, parseYen } = utils;

// Property-based tests over the pure month/date/amount logic. The
// 13-month rotation wrapper and the JSON→XML conversion live outside
// this repo (on the home server), so the properties pin what this repo
// guarantees to them: only real months are ever accepted, only rows
// whose date really exists in the target month pass validation, and
// amounts are exact or null.

const daysInMonth = (year, month) => new Date(year, month, 0).getDate();
const monthIndexOf = (year, month) => year * 12 + (month - 1);
const fromIndex = (idx) => ({ year: Math.floor(idx / 12), month: (idx % 12) + 1 });
const pad2 = (n) => String(n).padStart(2, '0');
const formatMonthStr = ({ year, month }) => `${year}-${pad2(month)}`;

const yearMonthArb = fc.record({
  year: fc.integer({ min: 1970, max: 2100 }),
  month: fc.integer({ min: 1, max: 12 }),
});

describe('property: parseTargetMonth', () => {
  it('round-trips every real YYYY-MM', () => {
    fc.assert(
      fc.property(yearMonthArb, (ym) => {
        expect(parseTargetMonth(formatMonthStr(ym))).toEqual(ym);
      }),
      { numRuns: 100 }
    );
  });

  it('never throws on arbitrary input and only ever returns a real month', () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        const parsed = parseTargetMonth(value);
        if (parsed === null) return;
        expect(parsed.month).toBeGreaterThanOrEqual(1);
        expect(parsed.month).toBeLessThanOrEqual(12);
        expect(Number.isInteger(parsed.year)).toBe(true);
        // Re-parsing the canonical form is a fixed point.
        expect(parseTargetMonth(formatMonthStr(parsed))).toEqual(parsed);
      }),
      { numRuns: 100 }
    );
  });
});

describe('property: parseDisplayedMonthTitle', () => {
  it('parses the range start of a real month heading', () => {
    fc.assert(
      fc.property(yearMonthArb, ({ year, month }) => {
        const title = `${year}/${month}/1 - ${year}/${month}/${daysInMonth(year, month)}`;
        expect(parseDisplayedMonthTitle(title)).toEqual({ year, month });
      }),
      { numRuns: 100 }
    );
  });

  it('never returns an impossible month or day for arbitrary headings', () => {
    const headingArb = fc
      .record({
        year: fc.integer({ min: 0, max: 99999 }),
        month: fc.integer({ min: 0, max: 99 }),
        day: fc.integer({ min: 0, max: 99 }),
      })
      .map(({ year, month, day }) => `${year}/${month}/${day} - ${year}/${month}/${day}`);
    fc.assert(
      fc.property(fc.oneof(fc.string(), headingArb), (title) => {
        const parsed = parseDisplayedMonthTitle(title);
        if (parsed === null) return;
        expect(parsed.month).toBeGreaterThanOrEqual(1);
        expect(parsed.month).toBeLessThanOrEqual(12);
      }),
      { numRuns: 100 }
    );
  });

  it('rejects every heading whose range start is not a real date', () => {
    const impossibleArb = fc
      .record({
        year: fc.integer({ min: 1970, max: 2100 }),
        month: fc.integer({ min: 1, max: 12 }),
        day: fc.integer({ min: 1, max: 31 }),
      })
      .filter(({ year, month, day }) => day > daysInMonth(year, month));
    fc.assert(
      fc.property(impossibleArb, ({ year, month, day }) => {
        expect(parseDisplayedMonthTitle(`${year}/${month}/${day} - x`)).toBeNull();
      }),
      { numRuns: 100 }
    );
  });
});

describe('property: findOutOfMonthTransactions', () => {
  it('flags exactly the rows that are not real dates inside the target month', () => {
    const rowArb = fc.record({
      month: fc.integer({ min: 0, max: 13 }),
      day: fc.integer({ min: 0, max: 32 }),
      suffix: fc.constantFrom('', '(月)', '(水)'),
    });
    fc.assert(
      fc.property(yearMonthArb, fc.array(rowArb, { maxLength: 20 }), (target, rows) => {
        const txs = rows.map(({ month, day, suffix }) => ({
          date: `${pad2(month)}/${pad2(day)}${suffix}`,
        }));
        const expected = txs
          .filter(
            ({ date }) =>
              !(
                Number(date.slice(0, 2)) === target.month &&
                Number(date.slice(3, 5)) >= 1 &&
                Number(date.slice(3, 5)) <= daysInMonth(target.year, target.month)
              )
          )
          .map(({ date }) => date);
        expect(findOutOfMonthTransactions(txs, target)).toEqual(expected);
      }),
      { numRuns: 100 }
    );
  });

  it('never throws on arbitrary date strings and only returns input dates', () => {
    fc.assert(
      fc.property(
        yearMonthArb,
        fc.array(fc.record({ date: fc.string() }), { maxLength: 10 }),
        (target, txs) => {
          const bad = findOutOfMonthTransactions(txs, target);
          for (const entry of bad) {
            expect(txs.map((tx) => tx.date)).toContain(entry);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('property: navigateToTargetMonth', () => {
  it('clicks exactly the month distance, in the right direction, and lands on target', async () => {
    // A fake calendar that steps one month per click, like the real one.
    await fc.assert(
      fc.asyncProperty(
        yearMonthArb,
        fc.integer({ min: -24, max: 24 }),
        async (start, delta) => {
          let current = monthIndexOf(start.year, start.month);
          const targetIdx = current + delta;
          const target = fromIndex(targetIdx);
          const clicks = [];
          const page = {
            evaluate: vi.fn(async (fn, arg) => {
              if (arg !== '.fc-header-title h2') return undefined;
              const { year, month } = fromIndex(current);
              return `${year}/${month}/1 - ${year}/${month}/${daysInMonth(year, month)}`;
            }),
            waitForTimeout: vi.fn().mockResolvedValue(undefined),
            click: vi.fn(async (selector) => {
              clicks.push(selector);
              current += selector.includes('fc-button-prev') ? -1 : 1;
            }),
          };
          const displayed = await navigateToTargetMonth(page, target, { error: () => {} });
          expect(displayed).toEqual(target);
          expect(clicks).toHaveLength(Math.abs(delta));
          if (delta > 0) {
            expect(clicks.every((s) => s.includes('fc-button-next'))).toBe(true);
          }
          if (delta < 0) {
            expect(clicks.every((s) => s.includes('fc-button-prev'))).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('property: parseYen / parsePercent', () => {
  it('round-trips plain, comma-grouped and full-width amounts exactly', () => {
    // -0 is excluded by construction: "-0円" has no distinct yen value
    // and Object.is(-0, 0) would make the comparison spurious.
    fc.assert(
      fc.property(fc.integer({ min: -999_999_999, max: 999_999_999 }), (n) => {
        const grouped = Math.abs(n).toLocaleString('en-US');
        const text = `${n < 0 ? '-' : ''}${grouped}円`;
        expect(parseYen(text)).toBe(n);
        const fullWidth = text.replace(/[0-9]/g, (c) =>
          String.fromCharCode(c.charCodeAt(0) + 0xfee0)
        );
        expect(parseYen(fullWidth)).toBe(n);
      }),
      { numRuns: 100 }
    );
  });

  it('returns null or an exact finite number for arbitrary text, never throws', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const yen = parseYen(text);
        expect(yen === null || (Number.isInteger(yen) && Number.isFinite(yen))).toBe(true);
        const pct = parsePercent(text);
        expect(pct === null || Number.isFinite(pct)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});

describe('property: normalizeCfResult', () => {
  it('keeps exactly the rows with non-empty content, in order, without throwing', () => {
    const fieldArb = fc.oneof(fc.string(), fc.constant(null), fc.integer());
    // Content uses a restricted alphabet (letters, digits, plain spaces)
    // so the oracle below can state the whitespace normalization exactly;
    // NBSP/newline handling is pinned by the unit tests instead.
    const contentArb = fc.oneof(
      fc
        .array(fc.constantFrom('a', 'b', '1', ' '), { maxLength: 12 })
        .map((chars) => chars.join('')),
      fc.constant(null),
      fc.integer()
    );
    const rowArb = fc.record({
      date: fieldArb,
      content: contentArb,
      amount_text: fieldArb,
      account: fieldArb,
      category_main: fieldArb,
      category_sub: fieldArb,
      memo: fieldArb,
      is_transfer: fc.boolean(),
    });
    fc.assert(
      fc.property(fc.array(rowArb, { maxLength: 10 }), (rows) => {
        const result = normalizeCfResult({ timestamp: 't', transactions: rows });
        const expectedContents = rows
          .map((row) => (row.content == null ? '' : String(row.content)).replace(/ +/g, ' ').trim())
          .filter((content) => content !== '');
        expect(result.transactions.map((tx) => tx.content)).toEqual(expectedContents);
        for (const tx of result.transactions) {
          expect(tx.amount_yen === null || Number.isInteger(tx.amount_yen)).toBe(true);
          for (const key of ['date', 'content', 'account', 'category_main', 'category_sub', 'memo']) {
            expect(typeof tx[key]).toBe('string');
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});
