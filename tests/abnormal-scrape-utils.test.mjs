import { describe, it, expect } from 'vitest';

const { default: utils } = await import('../lib/scrape-utils.js');
const { normalizeWhitespace, parsePercent, parseYen } = utils;

// Abnormal-case tests for the amount/text boundary: everything here is
// text scraped out of a Money Forward page (or a missing/wrong-typed
// cell where the page structure changed). An amount that cannot be read
// as exactly one number must come back null — never a fabricated value,
// never a throw.

describe('parseYen — non-amount text must not be turned into an amount', () => {
  it('does not merge two amounts in a range into one fabricated amount', () => {
    expect(parseYen('1,000円～2,000円')).toBeNull();
    expect(parseYen('1,000円〜2,000円')).toBeNull();
  });

  it('does not drop an exponent marker and keep the digits', () => {
    expect(parseYen('1e5円')).toBeNull();
  });

  it('does not extract digits out of surrounding words', () => {
    expect(parseYen('abc123円')).toBeNull();
    expect(parseYen('残高1,000円')).toBeNull();
    expect(parseYen('1,000円(税込)')).toBeNull();
  });

  it('does not treat a full-width decimal point as no separator', () => {
    expect(parseYen('1．5円')).toBeNull();
  });

  it('still parses the formats Money Forward actually emits', () => {
    expect(parseYen('１,２３４円')).toBe(1234);
    expect(parseYen('▲2,500円')).toBe(-2500);
    expect(parseYen('(3,000円)')).toBe(-3000);
    expect(parseYen('-1,000円')).toBe(-1000);
    expect(parseYen('0円')).toBe(0);
    expect(parseYen('1,000 円')).toBe(1000);
  });
});

describe('parsePercent — full-width percent text must not be mangled', () => {
  it('does not turn １２．５％ into 125', () => {
    expect(parsePercent('１２．５％')).toBeNull();
  });

  it('still parses half-width percent text', () => {
    expect(parsePercent('12.5%')).toBe(12.5);
    expect(parsePercent('100%')).toBe(100);
  });
});

describe('parseYen / parsePercent / normalizeWhitespace — wrong-typed input never throws', () => {
  it('reads null and undefined as no value', () => {
    expect(parseYen(null)).toBeNull();
    expect(parseYen(undefined)).toBeNull();
    expect(parsePercent(null)).toBeNull();
    expect(normalizeWhitespace(null)).toBe('');
    expect(normalizeWhitespace(undefined)).toBe('');
  });

  it('never invents 1 from true and never throws on numbers or booleans', () => {
    expect(parseYen(true)).toBeNull();
    expect(parseYen(false)).toBeNull();
    expect(parseYen(1000)).toBe(1000);
    expect(normalizeWhitespace(42)).toBe('42');
  });

  it('keeps string behaviour unchanged', () => {
    expect(normalizeWhitespace('  foo\u00a0bar \n baz ')).toBe('foo bar\nbaz');
    expect(parseYen('')).toBeNull();
    expect(parseYen('円')).toBeNull();
    expect(parseYen('-')).toBeNull();
  });
});
