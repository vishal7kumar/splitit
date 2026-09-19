export const currencySymbols: Record<string, string> = {
  INR: "₹",
  RS: "₹",
  USD: "$",
  EUR: "€",
  GBP: "£",
};

export function getCurrencySymbol(code: string): string {
  const normalized = (code || "").trim().toUpperCase();
  return currencySymbols[normalized] || currencySymbols[code] || code;
}

export function formatIndianNumber(amount: number): string {
  const absAmount = Math.abs(amount);
  const fixed = absAmount.toFixed(2);
  const [intPart, decPart] = fixed.split(".");
  const lastThree = intPart.slice(-3);
  const rest = intPart.slice(0, -3);
  const withCommas =
    rest !== ""
      ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + lastThree
      : lastThree;
  return `${amount < 0 ? "-" : ""}${withCommas}.${decPart}`;
}

export function formatCurrency(code: string, amount: number): string {
  const normalizedCode = (code || "").trim().toUpperCase();
  const isIndian = normalizedCode === "INR" || normalizedCode === "RS";
  const currencyCode = isIndian ? "INR" : normalizedCode;
  const locale = isIndian ? "en-IN" : "en-US";

  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currencyCode,
    }).format(amount);
  } catch {
    const symbol = getCurrencySymbol(code);
    const isNegative = amount < 0;
    const prefix = isNegative ? "-" : "";
    if (isIndian) {
      return `${prefix}${symbol}${formatIndianNumber(Math.abs(amount))}`;
    }
    return `${prefix}${symbol}${Math.abs(amount).toFixed(2)}`;
  }
}

