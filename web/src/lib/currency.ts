export const currencySymbols: Record<string, string> = {
  INR: "₹",
  USD: "$",
  EUR: "€",
  GBP: "£",
};

export function getCurrencySymbol(code: string): string {
  return currencySymbols[code] || code;
}

export function formatCurrency(code: string, amount: number): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
    }).format(amount);
  } catch (e) {
    const symbol = getCurrencySymbol(code);
    return `${symbol}${amount.toFixed(2)}`;
  }
}
