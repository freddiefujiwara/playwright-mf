const normalizeWhitespace = (value = "") =>
  value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\r?\n+/g, "\n")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .trim();

const normalizeFullWidthDigits = (value = "") =>
  value.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 65248));

const normalizeNumberString = (value = "") => {
  const normalized = normalizeFullWidthDigits(value);
  return normalized
    .replace(/[−ー－]/g, "-")
    .replace(/▲/g, "-")
    .replace(/,/g, "")
    .replace(/\s+/g, "");
};

const parseNumber = (value, { strip = /[円%]/g, allowDecimal = true } = {}) => {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return null;
  let text = normalizeNumberString(normalized.replace(strip, ""));
  if (!text) return null;

  let isNegative = false;
  if (text.startsWith("(") && text.endsWith(")")) {
    isNegative = true;
    text = text.slice(1, -1);
  }

  text = text.replace(/[^\d.-]/g, "");
  if (!text || text === "-" || text === ".") return null;

  const number = Number(text);
  if (!Number.isFinite(number)) return null;
  const signed = isNegative ? -number : number;
  return allowDecimal ? signed : Math.trunc(signed);
};

const parseYen = (value) => parseNumber(value, { strip: /円/g, allowDecimal: false });

const parsePercent = (value) => parseNumber(value, { strip: /%/g, allowDecimal: true });

const pickFirst = (value, regex) => {
  const match = String(value ?? "").match(regex);
  return match ? match[1] : "";
};

const buildHeaders = (headers = [], rows = []) => {
  if (headers.length) return headers;
  const maxColumns = rows.reduce(
    (max, row) => Math.max(max, row.length),
    0
  );
  return Array.from({ length: maxColumns }, (_, i) => `col_${i + 1}`);
};

const parseTableData = ({
  headers = [],
  rows = [],
  actionHeaders = ["変更", "削除"],
} = {}) => {
  const normalizedHeaders = buildHeaders(
    headers.map((header) => normalizeWhitespace(header)),
    rows
  );

  const normalizedRows = rows.map((row) =>
    row.map((cell) => normalizeWhitespace(cell))
  );
  const actionIndexes = normalizedRows.reduce((acc, row) => {
    row.forEach((cell, index) => {
      if (actionHeaders.includes(cell)) {
        acc.add(index);
      }
    });
    return acc;
  }, new Set());

  const keepIndexes = normalizedHeaders
    .map((header, index) => ({ header, index }))
    .filter(
      ({ header, index }) =>
        !actionHeaders.includes(header) && !actionIndexes.has(index)
    )
    .map(({ index }) => index);

  const items = normalizedRows
    .filter((row) => row.some((cell) => cell !== ""))
    .map((row) => {
      const item = {};
      keepIndexes.forEach((index) => {
        item[normalizedHeaders[index] ?? `col_${index + 1}`] = row[index] ?? "";
      });
      return item;
    });

  return {
    headers: keepIndexes.map((index) => normalizedHeaders[index]),
    items,
  };
};

module.exports = {
  buildHeaders,
  normalizeNumberString,
  normalizeWhitespace,
  parseNumber,
  parsePercent,
  parseTableData,
  parseYen,
  pickFirst,
};
