export const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
export const pct = (n: number, d = 2) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(d)}%`;
export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
