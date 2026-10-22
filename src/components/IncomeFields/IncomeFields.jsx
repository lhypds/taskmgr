import { useTranslation } from "react-i18next";
import { useCallback, useState } from "react";
import { PlusIcon, XIcon } from "@components/icons";
import { INCOME_CURRENCIES, INCOME_PERIODS } from "@utils/income";
import styles from "./income.module.css";

// Each row being edited gets its own key, so removing one does not shift the inputs of the others.
let nextKey = 0;
const row = (amount = "", currency = INCOME_CURRENCIES[0], from = "") => ({ key: nextKey++, amount, currency, from });

// The rows to edit for an income: its monthly and one-time items.
function rowsOf(income) {
  return Object.fromEntries(INCOME_PERIODS.map((p) => [p, (income?.[p] || []).map((x) => row(String(x.amount), x.currency, x.from || ""))]));
}

// The state of the income fields; `reset(income)` starts them over from an income (null for none).
export function useIncomeFields() {
  const [hasIncome, setHasIncome] = useState(false);
  const [rows, setRows] = useState(() => rowsOf(null));
  const reset = useCallback((income) => {
    setHasIncome(!!income);
    setRows(rowsOf(income));
  }, []);
  return { hasIncome, setHasIncome, rows, setRows, reset };
}

// The income typed into the fields: { income } (null for "no income"), or { error } with the
// i18n key of what is wrong. Rows left empty are dropped; a monthly row's "from" is optional.
export function readIncome({ hasIncome, rows }) {
  if (!hasIncome) return { income: null };
  const income = {};
  for (const p of INCOME_PERIODS) {
    income[p] = [];
    for (const x of rows[p]) {
      const text = x.amount.replace(/,/g, "").trim();
      if (!text) continue;
      const amount = Number(text);
      if (!Number.isFinite(amount) || amount <= 0) return { error: "income.invalidAmount" };
      const from = p === "monthly" ? x.from.trim() : "";
      if (from && !/^\d{4}-(0[1-9]|1[0-2])$/.test(from)) return { error: "income.invalidFrom" };
      income[p].push(from ? { amount, currency: x.currency, from } : { amount, currency: x.currency });
    }
  }
  if (INCOME_PERIODS.every((p) => income[p].length === 0)) return { error: "income.empty" };
  return { income };
}

// Whether there is income; if there is, two lists, monthly and one-time, each of amount and
// currency. `fields` is from useIncomeFields.
export default function IncomeFields({ fields }) {
  const { t } = useTranslation();
  const { hasIncome, setHasIncome, rows, setRows } = fields;

  const setRow = (period, key, change) => setRows((r) => ({ ...r, [period]: r[period].map((x) => (x.key === key ? { ...x, ...change } : x)) }));
  const removeRow = (period, key) => setRows((r) => ({ ...r, [period]: r[period].filter((x) => x.key !== key) }));
  // A new row starts in the currency of the row above it.
  const addRow = (period) => setRows((r) => ({ ...r, [period]: [...r[period], row("", r[period].at(-1)?.currency)] }));

  function chooseIncome(on) {
    setHasIncome(on);
    // Start with one monthly row to fill in.
    if (on && INCOME_PERIODS.every((p) => rows[p].length === 0)) addRow("monthly");
  }

  return (
    <>
      <div className={styles.field} role="radiogroup" aria-label={t("income.title")}>
        <span className={styles.label}>{t("income.title")}</span>
        <div className={styles.choices}>
          {[true, false].map((on) => (
            <label key={String(on)} className={styles.choice}>
              <input type="radio" name="income" checked={hasIncome === on} onChange={() => chooseIncome(on)} />
              {t(on ? "income.hasIncome" : "income.noIncome")}
            </label>
          ))}
        </div>
      </div>

      {hasIncome &&
        INCOME_PERIODS.map((p) => (
          <div key={p} className={styles.field}>
            <span className={styles.label}>{t(`income.${p}`)}</span>
            {rows[p].map((x) => {
              // Keep a currency from the file selectable even when it is not in the usual list.
              const currencies = INCOME_CURRENCIES.includes(x.currency) ? INCOME_CURRENCIES : [x.currency, ...INCOME_CURRENCIES];
              return (
                <div key={x.key} className={styles.incomeRow}>
                  <input
                    className="input"
                    value={x.amount}
                    inputMode="decimal"
                    placeholder={t("income.amountPlaceholder")}
                    aria-label={t("income.amount")}
                    onChange={(e) => setRow(p, x.key, { amount: e.target.value })}
                  />
                  <select
                    className={`select ${styles.currency}`}
                    value={x.currency}
                    aria-label={t("income.currency")}
                    onChange={(e) => setRow(p, x.key, { currency: e.target.value })}
                  >
                    {currencies.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  {p === "monthly" && (
                    <label className={styles.fromLabel} title={t("income.from")}>
                      {t("income.fromLabel")}
                      <input
                        className={`input ${styles.from}`}
                        type="month"
                        value={x.from}
                        placeholder="2026-01"
                        aria-label={t("income.from")}
                        onChange={(e) => setRow(p, x.key, { from: e.target.value })}
                      />
                    </label>
                  )}
                  <button type="button" className="btn" title={t("income.remove")} aria-label={t("income.remove")} onClick={() => removeRow(p, x.key)}>
                    <XIcon />
                  </button>
                </div>
              );
            })}
            <button type="button" className={`btn ${styles.addRow}`} onClick={() => addRow(p)}>
              <PlusIcon />
              {t("income.add")}
            </button>
          </div>
        ))}
    </>
  );
}
