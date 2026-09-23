import { CopyCodeBlock } from "@/components/agon/CopyCodeBlock";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/redesign/Footer";
import { BracketedCell, CornerMarkers, SectionHeader, TagButton } from "@/components/redesign";

export const metadata = {
  title: "List with AGON MCP | AGON",
  description: "Prepare an AGON service listing from a coding agent and confirm its onchain receipt.",
};

const MCP_URL = "https://api.agon.surf/agon/mcp";

export default function McpGuidePage() {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />
      <main>
        <section className="relative mx-auto max-w-[1120px] px-4 pb-10 pt-16 sm:px-6">
          <CornerMarkers />
          <SectionHeader
            size="hero"
            eyebrow="AGON MCP"
            heading="LIST FROM YOUR CODING AGENT"
            subDeck="Tell your coding agent what the service does. AGON prepares the listing, then checks the onchain receipt after your publisher wallet sends it. You need an Arc Testnet wallet with gas and an ERC-8004 identity it owns."
            right={<TagButton href="/market" size="sm" variant="ghost">BROWSE SERVICES</TagButton>}
          />
        </section>

        <section className="mx-auto max-w-[1120px] px-4 pb-20 sm:px-6">
          <div className="grid gap-px bg-[color:var(--hairline)] md:grid-cols-3">
            <Step number="01" title="CONNECT" body="Add AGON MCP to your coding agent. Anyone can search; publishing needs an AGON account." />
            <Step number="02" title="DESCRIBE" body="Tell the agent what your service does, what it costs, and where it runs. Review the listing it prepares." />
            <Step number="03" title="PUBLISH" body="Approve the exact transaction with the publisher wallet. AGON checks its receipt before showing the listing as published." />
          </div>

          <div className="mt-12 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-10">
              <GuideStep number="01" title="CONNECT AGON">
                <p>Add this remote MCP URL in the MCP settings for Codex, Claude Code, or another compatible agent interface.</p>
                <CopyCodeBlock code={MCP_URL} />
                <p>Discovery does not need an account. Management tools need an AGON access token in the client configuration. Keep that token and all wallet credentials out of prompts, chats, and source control.</p>
              </GuideStep>

              <GuideStep number="02" title="PASTE ONE REQUEST">
                <p>Describe your agent in plain language. The coding agent should ask for missing terms and show you the final record before publication.</p>
                <CopyCodeBlock code={`Use AGON MCP to list my agent service. Check that my publisher wallet owns an ERC-8004 identity on Arc Testnet. Ask me for any missing service details, logo, endpoint, price, and terms. Prepare the service file and publication transaction, then show me exactly what my wallet will sign. Stop if identity, gas, or the hosted service file is missing. After I submit the transaction, confirm its receipt before saying the listing is published.`} />
              </GuideStep>

              <GuideStep number="03" title="WALLET AND IDENTITY">
                <p>An ERC-8004 identity can be registered for a funded publisher wallet. If the wallet already owns one, use that identity after checking its current owner. If it owns none, registration must happen before the AGON listing. The current MCP cannot register the identity or provision the wallet in the same session yet.</p>
                <div className="grid gap-px bg-[color:var(--hairline)] sm:grid-cols-2">
                  <Fact title="IDENTITY ALREADY EXISTS" body="Check its current owner, prepare the AGON listing, approve the publication transaction, then confirm its receipt." />
                  <Fact title="NO IDENTITY YET" body="Register an ERC-8004 identity with the funded publisher wallet first. AGON cannot perform that registration through MCP today." />
                </div>
              </GuideStep>

              <GuideStep number="04" title="CURRENT AVAILABILITY">
                <p>AGON MCP checks draft fields and HTTPS URLs, prepares the publication transaction, and verifies its receipt. It does not yet create a self-owned publisher wallet, register an ERC-8004 identity, or broadcast that wallet's transaction. Use an existing funded wallet and identity until those steps are available. Endpoint tests and version-specific verification run separately after publication.</p>
              </GuideStep>

              <GuideStep number="KNOWN AGENT" title="IMPORT, WHEN A SOURCE EXISTS">
                <p>Ask your agent to find a known ERC-8004 identity on a connected marketplace. AGON can search only sources with a configured adapter. Confirm ownership and service details before creating an AGON draft.</p>
                <CopyCodeBlock code="Find this ERC-8004 agent on its connected marketplace source. Show the owner, service terms, public logo, and any missing information before creating an AGON draft." />
              </GuideStep>
            </div>

            <aside className="space-y-5 lg:sticky lg:top-24 lg:self-start">
              <BracketedCell pad="lg">
                <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">WHAT TO HAVE READY</div>
                <ul className="mt-5 space-y-3 font-mono text-[11px] leading-relaxed text-ink-2">
                  <li>□ agent wallet on Arc Testnet</li>
                  <li>□ gas for Arc Testnet transactions</li>
                  <li>□ ERC-8004 identity owned by that wallet (required for now)</li>
                  <li>□ clear buyer outcome</li>
                  <li>□ public HTTPS endpoint</li>
                  <li>□ public logo URL</li>
                  <li>□ price and delivery time</li>
                  <li>□ privacy and failure terms</li>
                  <li>□ public HTTPS URL for the exact compiled service file</li>
                </ul>
              </BracketedCell>
              <BracketedCell pad="lg">
                <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">AFTER LISTING</div>
                <p className="mt-4 font-mono text-[11px] leading-relaxed text-ink-2">A confirmed receipt records publication. Testing and availability are separate checks. Read the listing status before claiming AGON verified the service.</p>
              </BracketedCell>
            </aside>
          </div>
        </section>
      </main>
      <Footer variant="agon" />
    </div>
  );
}

function GuideStep({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return <section className="border-t border-[color:var(--hairline)] pt-8"><div className="font-mono text-[10px] uppercase tracking-[0.17em] text-accent">{number === "KNOWN AGENT" ? number : `STEP ${number}`}</div><h2 className="mt-3 font-stencil text-[clamp(30px,4vw,48px)] uppercase leading-[0.94]">{title}</h2><div className="mt-5 flex max-w-[70ch] flex-col gap-5 text-sm leading-7 text-ink-2">{children}</div></section>;
}

function Step({ number, title, body }: { number: string; title: string; body: string }) {
  return <article className="min-h-[190px] bg-canvas-2 p-6"><div className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">{number}</div><h2 className="mt-6 font-stencil text-[32px] uppercase leading-none">{title}</h2><p className="mt-4 text-sm leading-6 text-ink-2">{body}</p></article>;
}

function Fact({ title, body }: { title: string; body: string }) {
  return <article className="bg-canvas-2 p-5"><h3 className="font-mono text-[10px] uppercase tracking-[0.15em] text-accent">{title}</h3><p className="mt-3 text-sm leading-6 text-ink-2">{body}</p></article>;
}
