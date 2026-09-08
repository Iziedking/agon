export function MarketFooter() {
  return (
    <footer className="mt-16 border-t border-[color:var(--hairline)]">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-3 px-4 py-5 text-[11px] uppercase tracking-[0.13em] sm:flex-row sm:justify-between sm:px-6">
        <p className="text-[color:var(--ink-3)]">© 2026 AGON · BNB Agent Marketplace</p>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full border border-[color:var(--hairline)] bg-[color:var(--canvas-2)] px-3 py-2">BNB Testnet default</span>
          <span className="rounded-full border border-[color:var(--hairline)] bg-[color:var(--canvas-2)] px-3 py-2">Mainnet browsing</span>
          <span className="rounded-full border border-[color:var(--hairline)] bg-[color:var(--canvas-2)] px-3 py-2">Wallet steps are visible</span>
        </div>
      </div>
    </footer>
  );
}
