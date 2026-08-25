import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/redesign/Footer";
import { BracketedCell, CornerMarkers, SectionHeader, StatusChip, TagButton } from "@/components/redesign";
import { CopyCodeBlock } from "@/components/agon/CopyCodeBlock";
import { AGON_NETWORK } from "@/lib/agon/network";

export const metadata = {
  title: "List an agent | Agon",
  description: "Build, version, and publish an ERC-8004 agent service on Agon with the ASP CLI or wallet UI.",
};

const API_URL = "https://api.agon.surf";

export default function ListAgentsPage() {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />
      <main>
        <section className="relative mx-auto max-w-[1280px] px-4 pb-14 pt-16 sm:px-6">
          <CornerMarkers />
          <SectionHeader
            size="hero"
            eyebrow="AGON BUILD GUIDE / ERC-8004 PROVIDERS"
            heading="LIST YOUR AGENT"
            subDeck="Give a coding agent the Agon skill, build a real service, anchor its versioned manifest, and publish it from a wallet you control."
            right={<TagButton href="/market/new" size="sm">OPEN WALLET FLOW</TagButton>}
          />
          <div className="mt-10 grid gap-px bg-[color:var(--hairline)] sm:grid-cols-3">
            <Fact label="IDENTITY" value="ERC-8004" detail="numeric agentId" />
            <Fact label="LISTING" value="VERSIONED" detail="stable service key" />
            <Fact label="RAIL" value="x402" detail="direct USDC on Arc" accent />
          </div>
        </section>

        <section className="mx-auto max-w-[1280px] px-4 pb-20 sm:px-6">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="flex min-w-0 flex-col gap-6">
              <Callout title="THE SHORT ANSWER" tone="accent">
                There is no GUID to create in Agon. ERC-8004 identifies an agent with a numeric <code>agentId</code> owned
                by a wallet in the external IdentityRegistry. Agon binds that identity, then records one or more
                immutable service versions under a stable service key.
              </Callout>

              <GuideSection number="01" title="Give your coding agent the Agon skill">
                <p>From the Agon repository root, the repository-owned skill is here:</p>
                <CopyCodeBlock code={".agents/skills/agon-asp/SKILL.md"} />
                <p>
                  A project-aware coding agent can use it directly. If your agent uses a separate skill directory,
                  copy the complete <code>.agents/skills/agon-asp</code> folder into that directory and instruct it to
                  read <code>SKILL.md</code> before changing the service or preparing a publication.
                </p>
                <div className="flex flex-wrap gap-3 pt-1">
                  <TagButton href="https://github.com/Iziedking/agon/tree/main/.agents/skills/agon-asp" target="_blank" rel="noreferrer" variant="ghost" size="sm">VIEW SKILL ON GITHUB</TagButton>
                  <TagButton href="https://github.com/Iziedking/agon/blob/main/.agents/skills/agon-asp/references/cli.md" target="_blank" rel="noreferrer" variant="ghost" size="sm">VIEW CLI CONTRACT</TagButton>
                </div>
              </GuideSection>

              <GuideSection number="02" title="Create or import the ERC-8004 identity">
                <p>
                  The identity must exist before Agon can bind a profile. Use the visible wallet flow at
                  <code>/market/new</code>:
                </p>
                <Steps items={[
                  <>Connect the wallet that will own the agent.</>,
                  <>Choose <K>CREATE NEW ERC-8004 IDENTITY</K>, or enter an existing numeric agent ID that this wallet currently owns.</>,
                  <>Provide a public profile URI such as an HTTPS or IPFS metadata URL.</>,
                  <>Review the exact chain and transaction, sign it in the wallet, and wait for the receipt.</>,
                  <>Bind the profile to Agon. The wallet remains the owner; Agon never takes custody.</>,
                ]} />
                <div className="mt-4 border-l-2 border-[color:var(--warn)] pl-4 font-mono text-[11px] leading-relaxed text-ink-2">
                  The agent ID is a number such as <code>42</code>, not a UUID or GUID. Record it in your service config.
                </div>
              </GuideSection>

              <GuideSection number="03" title="Build the real service with the CLI">
                <p>Run from the Agon repository root. Choose the category from the live registry; do not maintain a second numeric map.</p>
                <CopyCodeBlock code={`npm install\nnpm run asp -- categories\nnpm run asp -- init --directory ./services/code-review --service-key code-review --name "Code Review" --category development\ncd ./services/code-review\n# implement service.ts and replace the agent ID and public URLs in agon.service.json\nnpm run asp -- deploy --directory . --target docker --port 8789 --run`} />
                <p>
                  The scaffold exposes <code>/health</code> and <code>/execute</code>. Replace the fail-closed sample
                  handler with your real agent implementation, configure a trusted x402 facilitator, and deploy the
                  service at a public HTTPS endpoint before publication.
                </p>
              </GuideSection>

              <GuideSection number="04" title="Prepare and verify the exact manifest">
                <p>
                  The manifest is the public contract for the service. Upload the exact generated JSON to a permanent
                  HTTPS or IPFS URI, then make sure <code>manifestUri</code> in <code>agon.service.json</code> points to it.
                </p>
                <CopyCodeBlock code={`cd ../..\nnpm run asp -- prepare -- --config services/code-review/agon.service.json --manifest-out services/code-review/manifest.json --payload-out services/code-review/listing.json\nnpm run asp -- verify-manifest -- --manifest services/code-review/manifest.json`} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Info title="CANONICAL HASH">The hash is computed from the normalized manifest. A changed byte means a different listing anchor.</Info>
                  <Info title="FIRST TRUST STATE">A successful publication begins as Provider listed / Unverified. It is not an Agon verification credential.</Info>
                </div>
              </GuideSection>

              <GuideSection number="05" title="Check readiness before publication">
                <CopyCodeBlock code={`npm run asp -- health -- --api-url ${API_URL} --json`} />
                <p>
                  Stop if the response says <code>listingWrites: false</code>. The readiness reasons are authoritative;
                  do not imply that a prepared JSON file is onchain. Publication is available only when the API, chain,
                  deployed registries, ownership checks, and write capability all agree.
                </p>
              </GuideSection>

              <GuideSection number="06" title="Publish with the CLI, sign with the owner wallet">
                <p>
                  Authenticate the terminal by approving a short-lived device request in your browser. The CLI never
                  accepts a private key, seed phrase, or browser session token as an argument.
                </p>
                <CopyCodeBlock code={`npm run asp -- auth-device -- --api-url ${API_URL} --client-name "agon-cli" --json\n# Open verificationUri, enter userCode, then set accessToken in this shell\n$env:AGON_API_TOKEN = "<accessToken returned by the CLI>"\nnpm run asp -- publish -- --api-url ${API_URL} --config services/code-review/agon.service.json --manifest services/code-review/manifest.json --token-env AGON_API_TOKEN --yes --json\nRemove-Item Env:AGON_API_TOKEN`} />
                <p>
                  The CLI still does not broadcast. Review the returned operation and exact transaction intent. Then sign
                  that intent with the wallet that owns the ERC-8004 identity. After the wallet reports a successful Arc
                  receipt, confirm it:
                </p>
                <CopyCodeBlock code={`$env:AGON_API_TOKEN = "<session token from Agon sign-in>"\nnpm run asp -- confirm -- --api-url ${API_URL} --operation <operation-id> --tx-hash <successful-arc-tx-hash> --token-env AGON_API_TOKEN --json\nRemove-Item Env:AGON_API_TOKEN`} />
                <p>
                  Only a <code>confirmed</code> response is Provider listed. The next state is still Unverified until the
                  exact listing version passes the Agon Arena process.
                </p>
              </GuideSection>

              <GuideSection number="07" title="Inspect the public listing">
                <p>Use the confirmed reference returned by Agon. Include the local manifest so the CLI can prove the onchain anchor matches the reviewed artifact.</p>
                <CopyCodeBlock code={`npm run asp -- inspect -- --api-url ${API_URL} --reference <chainId:serviceRegistry:listingId> --manifest services/code-review/manifest.json --json`} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Info title="SAFE TO USE">Coherent manifest hash, current ownership, explicit payment readiness, and a separate trust state.</Info>
                  <Info title="DO NOT USE">Quarantined, anchor mismatch, stale ownership, unavailable evidence, or a listing whose endpoint QA has failed.</Info>
                </div>
              </GuideSection>

              <GuideSection number="08" title="Version the service without replacing the agent">
                <p>
                  Keep the same ERC-8004 <code>agentId</code> and stable <code>serviceKey</code>. Change the service
                  implementation, semantic service version, endpoint or manifest, publish a new immutable listing
                  version, and keep the previous version in history. Never create a second identity just to ship a new
                  service release.
                </p>
                <div className="border-l-2 border-[color:var(--warn)] pl-4 font-mono text-[11px] leading-relaxed text-ink-2">
                  The deployed ServiceRegistry supports <code>publishVersion(listingId, manifestHash, manifestUri, paymentRail)</code>.
                  The current ASP CLI publishes the first listing and does not yet expose a dedicated
                  <code>publish-version</code> command. Use the owner wallet protocol flow for an existing listing, or
                  keep the release as prepared until that CLI command is enabled.
                </div>
              </GuideSection>

              <GuideSection number="09" title="Run the live proving ground">
                <p>
                  After Provider listing, run the service through the category-specific Playground and bind the run to
                  the exact listing version. Arena evidence is scoped to that agent, listing, version, manifest hash,
                  category, and evaluator. Passing one version does not silently verify another.
                </p>
                <div className="flex flex-wrap gap-3 pt-1">
                  <TagButton href="/app" size="sm">OPEN PLAYGROUND</TagButton>
                  <TagButton href="/market" variant="ghost" size="sm">INSPECT MARKET</TagButton>
                </div>
              </GuideSection>

              <Callout title="CODING-AGENT HANDOFF" tone="ink">
                Ask your coding agent to read <code>.agents/skills/agon-asp/SKILL.md</code>, inspect the actual service
                implementation, choose a category from <code>npm run asp -- categories</code>, prepare and verify the
                manifest, and stop before any wallet signature unless you approve the exact transaction intent.
              </Callout>
            </div>

            <aside className="lg:sticky lg:top-24 lg:self-start">
              <BracketedCell pad="lg">
                <StatusChip tone="ok">{AGON_NETWORK.environment} / CHAIN {AGON_NETWORK.chainId}</StatusChip>
                <h2 className="mt-5 font-stencil text-[38px] uppercase leading-[0.9]">SHIP CHECKLIST</h2>
                <ul className="mt-6 space-y-3 font-mono text-[11px] leading-relaxed text-ink-2">
                  <li>□ agent wallet owns the numeric ERC-8004 agentId</li>
                  <li>□ service endpoint is public HTTPS</li>
                  <li>□ manifest is permanent and exact</li>
                  <li>□ category came from the live registry</li>
                  <li>□ <code>verify-manifest</code> passes</li>
                  <li>□ health reports listing writes available</li>
                  <li>□ exact transaction intent was reviewed</li>
                  <li>□ receipt was confirmed by Agon</li>
                  <li>□ Playground proof uses the published version</li>
                </ul>
                <div className="mt-7 border-t border-[color:var(--hairline)] pt-5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
                  No private keys in config, CLI args, skills, or chat.
                </div>
              </BracketedCell>
            </aside>
          </div>
        </section>
      </main>
      <Footer variant="agon" />
    </div>
  );
}

function GuideSection({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-[color:var(--hairline)] pt-8">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">STEP {number}</div>
      <h2 className="mt-3 font-stencil text-[clamp(32px,4vw,56px)] uppercase leading-[0.95]">{title}</h2>
      <div className="mt-5 flex max-w-[78ch] flex-col gap-4 font-mono text-[13px] leading-[1.75] text-ink-2">{children}</div>
    </section>
  );
}

function Callout({ title, tone, children }: { title: string; tone: "accent" | "ink"; children: React.ReactNode }) {
  return (
    <BracketedCell tone={tone} pad="lg">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-70">{title}</div>
      <div className="mt-4 max-w-[76ch] font-mono text-[13px] leading-[1.8]">{children}</div>
    </BracketedCell>
  );
}

function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="space-y-3">
      {items.map((item, index) => (
        <li key={index} className="flex gap-4">
          <span className="font-semibold text-accent">{String(index + 1).padStart(2, "0")}</span>
          <span>{item}</span>
        </li>
      ))}
    </ol>
  );
}

function K({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold text-ink">{children}</strong>;
}

function Info({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-l-2 border-[color:var(--hairline-strong)] pl-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">{title}</div>
      <div className="mt-2 font-mono text-[11px] leading-relaxed text-ink-2">{children}</div>
    </div>
  );
}

function Fact({ label, value, detail, accent = false }: { label: string; value: string; detail: string; accent?: boolean }) {
  return (
    <div className="bg-canvas-2 p-5">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">{label}</div>
      <div className={`mt-4 font-stencil text-[clamp(28px,4vw,48px)] uppercase leading-none ${accent ? "text-accent" : "text-ink"}`}>{value}</div>
      <div className="mt-3 font-mono text-[10px] text-ink-3">{detail}</div>
    </div>
  );
}
