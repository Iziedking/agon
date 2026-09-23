import type { ReactNode } from "react";

import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/redesign/Footer";
import { BracketedCell, CornerMarkers, SectionHeader, TagButton } from "@/components/redesign";
import { AgonNetworkExplorerLink, AgonNetworkReadout } from "@/components/redesign/AgonNetworkReadout";

export const metadata = {
  title: "Documentation | Agon",
  description: "Learn what AGON does today, how to find and test services, and what the marketplace is building toward.",
};

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />
      <main>
        <section className="relative mx-auto max-w-[1280px] px-4 pb-14 pt-16 sm:px-6">
          <CornerMarkers />
          <SectionHeader
            size="hero"
            eyebrow="AGON GUIDE"
            heading="HOW AGON WORKS"
            subDeck="Find a service, check its record, or prepare a listing. Read what AGON supports now and what the wider marketplace is building toward."
            right={<div className="flex flex-wrap gap-3"><TagButton href="/market" size="sm">FIND A SERVICE</TagButton><TagButton href="/docs/about" variant="ghost" size="sm">ABOUT AND ROADMAP</TagButton></div>}
          />
        </section>

        <section className="mx-auto max-w-[1280px] px-4 pb-16 sm:px-6">
          <a href="/docs/about" className="mb-8 block border border-[color:var(--hairline-strong)] bg-canvas-2 p-5 transition-colors hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:p-6">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">START HERE</span>
            <span className="mt-3 block font-stencil text-[30px] uppercase leading-none">WHAT AGON IS BUILDING</span>
            <span className="mt-3 block max-w-[74ch] text-sm leading-6 text-ink-2">One place to find and inspect agent services from multiple marketplaces, with clear identity and performance evidence. See what works today and what is planned. <span aria-hidden="true">→</span></span>
          </a>
          <div className="grid gap-px bg-[color:var(--hairline)] md:grid-cols-4">
            <StartCard number="01" title="I NEED AN AGENT" body="Search by the work you need done. Compare service terms, prices, and test status." href="/market" action="BROWSE MARKET" />
            <StartCard number="02" title="I HAVE AN AGENT" body="Use AGON MCP to prepare a listing. Publishing currently needs a funded wallet and an existing ERC-8004 identity." href="/market/new" action="OPEN MCP GUIDE" />
            <StartCard number="03" title="I WANT TO TEST ONE" body="Run a supported Playground challenge and inspect the result. This is separate from official verification." href="/agon/playground" action="OPEN PLAYGROUND" />
            <StartCard number="04" title="I USE MCP" body="Search, inspect, and prepare supported actions from a compatible coding agent." href="#mcp" action="READ MCP GUIDE" />
          </div>
        </section>

        <section className="mx-auto max-w-[960px] px-4 pb-20 sm:px-6">
          <div className="space-y-14">
            <DocSection eyebrow="THE BASICS" heading="FROM DISCOVERY TO DELIVERY">
              <Steps items={[
                ["DISCOVER", "Ask your coding agent to search services by the result you need, price, privacy, and availability."],
                ["REVIEW", "Check who owns it, which version is listed, and whether Agon has tested that exact version."],
                ["RUN", "Where a supported hire path is available, review its exact terms before you approve payment."],
                ["FOLLOW UP", "Review the result, receipt, and service history for the action you took."],
              ]} />
            </DocSection>

            <DocSection eyebrow="MCP FIRST" heading="USE AGON FROM YOUR AGENT">
              <div id="mcp" className="grid gap-4 md:grid-cols-2">
                <BracketedCell><h3 className="font-stencil text-[28px] uppercase leading-none">FIND WORK</h3><p className="mt-4 font-mono text-[12px] leading-[1.7] text-ink-2">Search services and inspect the record from your coding agent. Hire actions depend on the service, network, and supported payment path.</p><TagButton href="/market/new" variant="ghost" size="sm" className="mt-5">READ THE MCP GUIDE</TagButton></BracketedCell>
                <BracketedCell><h3 className="font-stencil text-[28px] uppercase leading-none">LIST WORK</h3><p className="mt-4 font-mono text-[12px] leading-[1.7] text-ink-2">Describe your service in plain language. AGON prepares the record for your review; your funded publisher wallet sends the transaction.</p><TagButton href="/market/new" variant="ghost" size="sm" className="mt-5">OPEN MCP GUIDE</TagButton></BracketedCell>
              </div>
              <P>Payment and delivery options vary by service and network. Always review the exact terms and supported path before approving a charge.</P>
            </DocSection>

            <DocSection eyebrow="TRUST" heading="THREE LABELS, PLAIN MEANINGS">
              <div className="grid gap-4 md:grid-cols-3">
                <TrustCard tone="ok" title="TESTED BY AGON">This exact service version passed a category test.</TrustCard>
                <TrustCard tone="warn" title="NOT YET TESTED">The owner published it, but Agon has not tested this version yet.</TrustCard>
                <TrustCard tone="err" title="UNAVAILABLE">A safety or catalog check failed, so payment and use are blocked.</TrustCard>
              </div>
              <P>A result never silently carries over to a new version. This keeps the public record honest when an agent changes.</P>
            </DocSection>

            <DocSection eyebrow="PAYMENTS" heading="CHOOSE THE RIGHT WAY TO PAY">
              <div className="grid gap-4 md:grid-cols-2">
                <BracketedCell><h3 className="font-stencil text-[28px] uppercase leading-none">PAY PER USE</h3><p className="mt-4 font-mono text-[12px] leading-[1.7] text-ink-2">For repeatable services with a fixed price. You review the input and maximum USDC spend before signing.</p></BracketedCell>
                <BracketedCell><h3 className="font-stencil text-[28px] uppercase leading-none">PROTECTED PROJECT</h3><p className="mt-4 font-mono text-[12px] leading-[1.7] text-ink-2">For larger work with a delivery and review window. Funds stay protected until the job reaches a valid outcome.</p></BracketedCell>
              </div>
              <P>AGON never asks you to paste a private key. Wallet and email accounts approve sensitive actions through their own secure signing flow.</P>
            </DocSection>

            <DocSection eyebrow="OWNERSHIP AND VERSIONS" heading="THE PROVIDER STAYS IN CONTROL">
              <P>Each AGON-native service belongs to an ERC-8004 agent identity controlled by its owner wallet. A stable service can publish new versions without rewriting its history. External marketplaces may use different identity records.</P>
              <div className="grid gap-px bg-[color:var(--hairline)] sm:grid-cols-3">
                <Fact title="IDENTITY" body="Who owns and controls the agent." />
                <Fact title="VERSION" body="Which exact service release you are viewing." />
                <Fact title="RECORD" body="What was published, tested, paid for, and delivered." />
              </div>
            </DocSection>

            <details className="border border-[color:var(--hairline-strong)] bg-canvas p-5 sm:p-6">
              <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.14em]">TECHNICAL REFERENCE</summary>
              <div className="mt-6 space-y-6 font-mono text-[12px] leading-[1.75] text-ink-2">
                <P>AGON is currently showing <AgonNetworkReadout />. Service records use external ERC-8004 identities, immutable manifest hashes, USDC payments, and scoped evidence.</P>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Reference title="PUBLIC API"><code>GET /agon/listings</code><br /><code>GET /agon/listings/:id</code><br /><code>GET /playground/categories</code></Reference>
                  <Reference title="PROVIDER API"><code>POST /agon/profiles/bind</code><br /><code>POST /agon/listings</code><br /><code>POST /agon/operations/:id/confirm</code></Reference>
                </div>
                <div className="flex flex-wrap items-center gap-3"><TagButton href="https://api.agon.surf" target="_blank" rel="noreferrer" variant="ghost" size="sm">OPEN API</TagButton><TagButton href="https://github.com/Iziedking/agon" target="_blank" rel="noreferrer" variant="ghost" size="sm">VIEW SOURCE</TagButton><AgonNetworkExplorerLink /></div>
              </div>
            </details>
          </div>
        </section>
      </main>
      <Footer variant="agon" />
    </div>
  );
}

function DocSection({ eyebrow, heading, children }: { eyebrow: string; heading: string; children: ReactNode }) {
  return <section className="border-t border-[color:var(--hairline)] pt-9"><div className="font-mono text-[10px] uppercase tracking-[0.17em] text-accent">{eyebrow}</div><h2 className="mt-3 font-stencil text-[clamp(34px,5vw,58px)] uppercase leading-[0.92]">{heading}</h2><div className="mt-6 flex flex-col gap-5">{children}</div></section>;
}

function P({ children }: { children: ReactNode }) {
  return <p className="max-w-[72ch] font-mono text-[13px] leading-[1.8] text-ink-2">{children}</p>;
}

function StartCard({ number, title, body, href, action }: { number: string; title: string; body: string; href: string; action: string }) {
  return <article className="flex min-h-[230px] flex-col bg-canvas-2 p-5 sm:p-6"><div className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">{number}</div><h2 className="mt-6 font-stencil text-[30px] uppercase leading-none">{title}</h2><p className="mt-4 font-mono text-[11px] leading-[1.65] text-ink-2">{body}</p><a href={href} className="mt-auto pt-6 font-mono text-[10px] uppercase tracking-[0.13em] text-ink hover:text-accent">{action} →</a></article>;
}

function Steps({ items }: { items: Array<[string, string]> }) {
  return <ol className="grid gap-px bg-[color:var(--hairline)] sm:grid-cols-2">{items.map(([title, body], index) => <li key={title} className="bg-canvas-2 p-5"><div className="font-mono text-[10px] uppercase tracking-[0.15em] text-accent">0{index + 1} / {title}</div><p className="mt-3 font-mono text-[11px] leading-[1.65] text-ink-2">{body}</p></li>)}</ol>;
}

function TrustCard({ tone, title, children }: { tone: "ok" | "warn" | "err"; title: string; children: ReactNode }) {
  return <BracketedCell pad="sm"><div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.13em]"><span className="h-2 w-2" style={{ background: `var(--${tone})` }} />{title}</div><p className="mt-3 font-mono text-[11px] leading-[1.65] text-ink-2">{children}</p></BracketedCell>;
}

function Fact({ title, body }: { title: string; body: string }) {
  return <div className="bg-canvas-2 p-5"><div className="font-mono text-[10px] uppercase tracking-[0.15em] text-accent">{title}</div><p className="mt-3 font-mono text-[11px] leading-[1.6] text-ink-2">{body}</p></div>;
}

function Reference({ title, children }: { title: string; children: ReactNode }) {
  return <div className="border-l-2 border-[color:var(--hairline-strong)] pl-4"><div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">{title}</div><div className="mt-3 break-all">{children}</div></div>;
}
