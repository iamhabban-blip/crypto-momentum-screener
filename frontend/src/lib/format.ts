export const FACTORS: { key: string; label: string; short: string; explain: string }[] = [
  { key: "trend", label: "Trend", short: "T",
    explain: "Price rising over 1, 3 and 7 days, above a rising 50- and 200-hour average." },
  { key: "volume", label: "Volume", short: "V",
    explain: "Last hour's volume vs the previous 249 hours - only counts when the candle closed up." },
  { key: "relative_strength", label: "Strength vs BTC", short: "R",
    explain: "How much the coin beat Bitcoin over the past 7 days (+20 points = full marks)." },
  { key: "breakout", label: "Breakout", short: "B",
    explain: "Closed above its highest price of the last 3 days, or better, the last 7 days." },
  { key: "rsi", label: "RSI zone", short: "S",
    explain: "RSI(14) between 50 and 70: strong but not overheated. Above 80 scores zero." },
  { key: "no_chase", label: "No chasing", short: "C",
    explain: "Penalises coins already up 20-30%+ in 24 hours or swinging wildly." },
];

export function price(v: number | null | undefined): string {
  if (v == null) return "—";
  const digits = v >= 1000 ? 2 : v >= 1 ? 4 : v >= 0.01 ? 5 : 8;
  return v.toLocaleString("en-US", { minimumFractionDigits: Math.min(digits, 2), maximumFractionDigits: digits });
}

export function pct(v: number | null | undefined, digits = 2, fraction = true): string {
  if (v == null) return "—";
  const x = fraction ? v * 100 : v;
  return `${x > 0 ? "+" : ""}${x.toFixed(digits)}%`;
}

export function compact(v: number | null | undefined): string {
  if (v == null) return "—";
  return Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function hourLabel(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });
}

export function base(symbol: string) {
  return symbol.endsWith("USDT") ? symbol.slice(0, -4) : symbol;
}

export function scoreTone(score: number): { text: string; bar: string; label: string } {
  if (score >= 75) return { text: "text-up", bar: "from-emerald-400 to-up", label: "Strong" };
  if (score >= 60) return { text: "text-amber-400", bar: "from-amber-400 to-amber-500", label: "Building" };
  if (score >= 40) return { text: "text-violet-300", bar: "from-violet-400 to-violet-600", label: "Mixed" };
  return { text: "text-mute", bar: "from-ink-600 to-ink-700", label: "Weak" };
}
