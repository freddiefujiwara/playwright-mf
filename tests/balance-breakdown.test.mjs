import { expect, it } from "vitest";
import portfolio from "../bs-portfolio.js";
import liability from "../bs-liability.js";

it.each([
  ["portfolio", portfolio.normalizePortfolioResult],
  ["liability", liability.normalizeLiabilityResult],
])("preserves %s breakdown row normalization", (_name, normalize) => {
  const result = normalize({
    details: [],
    breakdown: [
      { category: "  株式\u00a0 A  ", amount_text: " ▲１,２３４.9円 ", percentage_text: " -12.5% " },
      { category: "  ", amount_text: "123円", percentage_text: "100%" },
      { category: "その他", amount_text: "—", percentage_text: null },
    ],
  });

  expect(result.breakdown).toEqual([
    {
      category: "株式 A",
      amount_text: "▲１,２３４.9円",
      amount_yen: -1234,
      percentage_text: "-12.5%",
      percentage: -12.5,
    },
    {
      category: "その他",
      amount_text: "—",
      amount_yen: null,
      percentage_text: "",
      percentage: null,
    },
  ]);
});
