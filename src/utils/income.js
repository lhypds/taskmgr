// A work's income is { monthly: [...], once: [...] }, each a list of { amount, currency }; a monthly
// item may also have "from", the year and month it starts ("2026-01").

export const INCOME_PERIODS = ["monthly", "once"];

export const INCOME_CURRENCIES = ["JPY", "CNY", "USD", "EUR", "GBP", "HKD", "TWD", "KRW", "SGD", "AUD", "CAD"];

// The items of one period added up per currency and start month: "500,000 JPY (from 2026-01) + 1,000 USD".
function total(items, t) {
  const sums = new Map();
  for (const x of items) {
    const key = `${x.currency} ${x.from || ""}`;
    sums.set(key, { ...x, amount: (sums.get(key)?.amount || 0) + x.amount });
  }
  return [...sums.values()]
    .map((x) => `${x.amount.toLocaleString()} ${x.currency}${x.from ? t("income.fromValue", { from: x.from }) : ""}`)
    .join(" + ");
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
    .map((p) => t(p === "monthly" ? "income.perMonth" : "income.perOnce", { value: total(income[p], t) }))
    .join(" · ");
}

// How many months of a monthly item fall in `year`: all 12 without a start month, none when it
// starts after the year, and from its start month on when it starts in it.
export function monthsIn(from, year) {
  if (!from) return 12;
  const [y, m] = from.split("-").map(Number);
  return y < year ? 12 : y > year ? 0 : 13 - m;
}

// Every currency used by `entries` ({ income } each), most used first.
export function currenciesOf(entries) {
  const counts = new Map();
  for (const e of entries)
    for (const p of INCOME_PERIODS) for (const x of e.income?.[p] || []) counts.set(x.currency, (counts.get(x.currency) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

// The years an analysis can pick: from the earliest start month (or last year) to next year.
export function yearsOf(entries, now = new Date().getFullYear()) {
  const starts = entries.flatMap((e) => (e.income?.monthly || []).filter((x) => x.from).map((x) => Number(x.from.slice(0, 4))));
  const first = Math.min(now - 1, ...starts);
  const last = Math.max(now + 1, ...starts);
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

// One entry's income in `currency` for `year`: the monthly total, that times 12 (annual), what the
// monthly items actually pay in the year given their start months, and the one-time total.
export function incomeFigures(income, currency, year) {
  const monthly = (income?.monthly || []).filter((x) => x.currency === currency);
  const once = (income?.once || []).filter((x) => x.currency === currency);
  const perMonth = monthly.reduce((sum, x) => sum + x.amount, 0);
  return {
    perMonth,
    annual: perMonth * 12,
    inYear: monthly.reduce((sum, x) => sum + x.amount * monthsIn(x.from, year), 0),
    once: once.reduce((sum, x) => sum + x.amount, 0),
  };
}
