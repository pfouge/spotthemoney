export function formatPercent(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  // A date-only string ("2026-05-01") parses as UTC midnight; format it in UTC so it does not
  // slip to the previous day in US timezones. Timestamps keep the local rendering.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  return d.toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric", ...(dateOnly ? { timeZone: "UTC" } : {}),
  });
}

export function formatCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
