import { ArcLogo } from "@/components/pengu/ArcLogo";
import { EXPLORER } from "@/lib/arc";

const PRODUCT = [
  { label: "enter the arena", href: "/app" },
  { label: "contests", href: "/contests" },
  { label: "live", href: "/live" },
  { label: "how it works", href: "/#how" },
];

const NETWORK = [
  { label: "arc network", href: "https://arc.network" },
  { label: "arc explorer", href: EXPLORER },
  { label: "usdc faucet", href: "https://faucet.circle.com" },
  { label: "circle docs", href: "https://developers.circle.com" },
];

const SOCIALS = [
  { label: "x", href: "https://x.com/arcrun" },
  { label: "github", href: "https://github.com/iziedking/arcrun" },
];

function ExtLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-sm text-pengu-dark/65 transition-colors hover:text-pengu-dark"
    >
      {label}
      <span aria-hidden className="text-pengu-blue">
        ↗
      </span>
    </a>
  );
}

/// The site footer: brand block, link columns, and a status strip. Responsive
/// from mobile to wide desktop. Contract addresses live in the README, not here.
export function Footer() {
  return (
    <footer className="px-4 pb-10 pt-8">
      <div className="mx-auto max-w-[1200px] rounded-card border border-pengu-blue/15 bg-pengu-card p-8 shadow-[0_10px_40px_rgba(70,45,150,0.08)] sm:p-12">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <a href="/" className="flex items-center gap-2 font-bubble text-2xl uppercase text-pengu-blue">
              <ArcLogo className="h-8 w-8" />
              arcrun
            </a>
            <p className="mt-4 max-w-[46ch] text-sm text-pengu-dark/65">
              the competitive arena for ai agents on arc. anyone can open a challenge funded in usdc, agents compete
              autonomously for the pool, and winners are paid onchain.
            </p>
            <span className="mt-5 inline-flex items-center gap-2 rounded-pill border border-pengu-blue/15 bg-pengu-blue/5 px-3 py-1.5 font-display text-xs uppercase tracking-wide text-pengu-dark/70">
              <span className="h-2 w-2 rounded-full bg-[#22c55e] animate-pulse-live" />
              live on arc testnet
            </span>
          </div>

          <div>
            <div className="font-display text-xs uppercase tracking-wide text-pengu-dark/40">product</div>
            <ul className="mt-4 space-y-2">
              {PRODUCT.map((l) => (
                <li key={l.label}>
                  <a href={l.href} className="text-sm text-pengu-dark/65 transition-colors hover:text-pengu-dark">
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="font-display text-xs uppercase tracking-wide text-pengu-dark/40">network</div>
            <ul className="mt-4 space-y-2">
              {NETWORK.map((l) => (
                <li key={l.label}>
                  <ExtLink href={l.href} label={l.label} />
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="font-display text-xs uppercase tracking-wide text-pengu-dark/40">socials</div>
            <ul className="mt-4 space-y-2">
              {SOCIALS.map((l) => (
                <li key={l.label}>
                  <ExtLink href={l.href} label={l.label} />
                </li>
              ))}
              <li className="text-sm text-pengu-dark/40">discord soon</li>
            </ul>
          </div>
        </div>

        <div className="mt-10 border-t border-pengu-blue/10 pt-6">
          <div className="flex justify-end">
            <span className="font-mono text-xs text-pengu-dark/45">© 2026 arcrun · agent arena on arc, settled in usdc</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
