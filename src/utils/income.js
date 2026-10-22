// A work's income is { monthly: [...], once: [...] }, each a list of { amount, currency }.

export const INCOME_PERIODS = ["monthly", "once"];

export const INCOME_CURRENCIES = ["JPY", "CNY", "USD", "EUR", "GBP", "HKD", "TWD", "KRW", "SGD", "AUD", "CAD"];

// The items of one period added up per currency: "500,000 JPY + 1,000 USD".
function total(items) {
  const sums = new Map();
  for (const x of items) sums.set(x.currency, (sums.get(x.currency) || 0) + x.amount);
  return [...sums].map(([currency, amount]) => `${amount.toLocaleString()} ${currency}`).join(" + ");
}

// The income in short, in units of 10,000 (万) whatever the currency: the one-time total, then
// "m" and the monthly total, as "44 + m7", "55" or "m70"; "" when there is none.
export function formatIncomeShort(income) {
  if (!income) return "";
  const man = (items) => Number((items.reduce((sum, x) => sum + x.amount, 0) / 10000).toFixed(2)).toLocaleString();
  const parts = [];
  if (income.once?.length) parts.push(man(income.once));
  if (income.monthly?.length) parts.push(`m${man(income.monthly)}`);
  return parts.join(" + ");
}

// "500,000 JPY / month · 100,000 JPY one-time" in the current language; "" when there is none.
export function formatIncome(income, t) {
  if (!income) return "";
  return INCOME_PERIODS.filter((p) => income[p]?.length)
    .map((p) => t(p === "monthly" ? "income.perMonth" : "income.perOnce", { value: total(income[p]) }))
    .join(" · ");
}
