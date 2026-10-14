export const marketingStreams = [
  { tag: "business-google", name: "Business Google · 10%", channel: "google", budget: "Business", rateBps: 1000 },
  { tag: "business-meta", name: "Business Meta · 10%", channel: "meta", budget: "Business", rateBps: 1000 },
  { tag: "dima-google", name: "Dima Google · 25%", channel: "google", budget: "Dima", rateBps: 2500 },
] as const;

// Stored source names and URL tags stay stable so existing links and ledger entries keep matching.
export function marketingStreamLabel(value: string) {
  const labels: Record<string, string> = {
    "Business Google · 10%": "Business Google",
    "Business Meta · 10%": "Business Meta",
    "Dima Google · 25%": "Partner Google",
    "Dima Leads": "Partner leads",
    "West Loop Leads": "Business leads",
  };
  return labels[value] || value;
}
export function marketingBudgetLabel(value: string) { return value === "Dima" ? "Partner" : value; }
