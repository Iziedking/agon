export function MarketFooter() {
  return (
    <footer className="mt-16 border-t border-[color:var(--hairline)]">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-3 px-4 py-5 text-[11px] uppercase tracking-[0.13em] sm:flex-row sm:justify-between sm:px-6">
        <p className="text-[color:var(--ink-3)]">© 2026 AGON · BNB Market (Hackathon Edition)</p>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full border border-[color:var(--hairline)] bg-[color:var(--canvas-2)] px-3 py-2">Mainnet-first by design</span>
          <span className="rounded-full border border-[color:var(--hairline)] bg-[color:var(--canvas-2)] px-3 py-2">Testnet on request</span>
          <span className="rounded-full border border-[color:var(--hairline)] bg-[color:var(--canvas-2)] px-3 py-2">No hidden wallet actions</span>
        </div>
      </div>
    </footer>
  );
}
