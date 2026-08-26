"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { keccak256, stringToHex } from "viem";

import { AppHeader } from "@/components/pengu/AppHeader";
import { BracketedCell } from "@/components/redesign/BracketedCell";
import { CornerMarkers } from "@/components/redesign/CornerMarkers";
import { Footer } from "@/components/redesign/Footer";
import { SectionHeader } from "@/components/redesign/SectionHeader";
import { TagButton } from "@/components/redesign/TagButton";
import { useOperatorAddress } from "@/hooks/useAuth";
import { useArcWrite } from "@/hooks/useArcWrite";
import { confirmTx } from "@/lib/arc";
import {
  AGON_PROFILE_REGISTRY,
  AGON_SERVICE_REGISTRY,
  agonProfileRegistryAbi,
  agonServiceRegistryAbi,
} from "@/lib/agon/abi";
import { AGON_CATEGORIES, categoryById } from "@/lib/agon/catalog";
import { bindProfile, confirmAgonOperation, getAgonHealth, publishListing } from "@/lib/agon/client";
import { canonicalManifestHash } from "@/lib/agon/canonical";
import { buildServiceManifest, validateServiceDraft } from "@/lib/agon/draft";
import type { AgonCapabilities, PaymentRail } from "@/lib/agon/types";
import { AGON_NETWORK } from "@/lib/agon/network";
import { AGON_IDENTITY_REGISTRY, agonIdentityRegistryAbi, identityIdFromRegistrationReceipt, resolveIdentityActions, validateIdentityMetadataUri } from "@/lib/agon/identity";

const INPUT_CLASS = "h-12 w-full border border-[color:var(--hairline-strong)] bg-canvas px-4 font-mono text-[12px] text-ink outline-none placeholder:text-ink-3 focus:border-ink focus:ring-2 focus:ring-ink focus:ring-offset-2 focus:ring-offset-canvas disabled:opacity-50";

export default function NewListingPage() {
  const { isSignedIn, settling } = useOperatorAddress();
  const { writeContractAsync, signerAddress: address } = useArcWrite();
  const [capabilities, setCapabilities] = useState<AgonCapabilities | null>(null);
  const [agentId, setAgentId] = useState("");
  const [metadataUri, setMetadataUri] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [serviceKeyLabel, setServiceKeyLabel] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [tags, setTags] = useState("");
  const [amountUSDC, setAmountUSDC] = useState("");
  const [manifestUri, setManifestUri] = useState("");
  const [paymentRail, setPaymentRail] = useState<PaymentRail>("X402");
  const [binding, setBinding] = useState(false);
  const [creatingIdentity, setCreatingIdentity] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "warn" | "error"; message: string } | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<{
    operationId: string;
    txHash: `0x${string}`;
    label: string;
  } | null>(null);
  const [identityBindingProof, setIdentityBindingProof] = useState<{
    txHash: `0x${string}` | null;
    blockNumber: string | null;
  } | null>(null);

  useEffect(() => {
    let live = true;
    getAgonHealth()
      .then((health) => { if (live) setCapabilities(health.capabilities); })
      .catch(() => { if (live) setCapabilities(null); });
    return () => { live = false; };
  }, []);

  const automaticServiceKey = useMemo(
    () => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64),
    [name],
  );
  const effectiveServiceKey = serviceKeyLabel.trim() || automaticServiceKey;

  const draft = useMemo(() => ({
    agentId,
    name,
    description,
    categoryId,
    serviceKey: effectiveServiceKey,
    endpoint,
    tags,
    amountUSDC,
  }), [agentId, name, description, categoryId, effectiveServiceKey, endpoint, tags, amountUSDC]);
  const issues = useMemo(() => validateServiceDraft(draft), [draft]);
  const selectedCategory = categoryId ? categoryById(categoryId) : null;
  const serviceKey = useMemo(
    () => effectiveServiceKey ? keccak256(stringToHex(effectiveServiceKey)) : "",
    [effectiveServiceKey],
  );
  const manifest = useMemo(() => issues.length ? null : buildServiceManifest(draft), [draft, issues.length]);
  const manifestJson = useMemo(() => manifest ? JSON.stringify(manifest, null, 2) : "", [manifest]);
  const manifestHash = useMemo(() => manifest ? canonicalManifestHash(manifest) : "", [manifest]);

  const profileWritesUnavailable = capabilities ? !capabilities.profileWrites : false;
  const listingWritesUnavailable = capabilities ? !capabilities.listingWrites : false;
  const writeReadinessMessage = capabilities
    ? readinessMessage(capabilities.writeReadiness.reasons)
    : null;
  const identityActions = useMemo(() => resolveIdentityActions({
    isSignedIn,
    agentId,
    metadataUri,
    creating: creatingIdentity,
    binding,
    bound: Boolean(identityBindingProof),
    profileWritesUnavailable,
  }), [agentId, binding, creatingIdentity, identityBindingProof, isSignedIn, metadataUri, profileWritesUnavailable]);
  const manifestUriValid = /^(https:\/\/|ipfs:\/\/).+/i.test(manifestUri.trim());
  const readyToPublish = Boolean(isSignedIn && serviceKey && manifestHash && manifestUriValid && !listingWritesUnavailable);

  async function submitBinding() {
    if (!address) {
      setNotice({ tone: "error", message: "Choose the wallet that owns this identity before binding it." });
      return;
    }
    setNotice(null);
    setBinding(true);
    try {
      const operation = await bindProfile({ chainId: AGON_NETWORK.chainId, agentId, metadataUri }, address);
      if (operation.state === "confirmed") {
        setIdentityBindingProof({
          txHash: operation.txHash,
          blockNumber: operation.proof?.blockNumber ?? null,
        });
        setNotice({ tone: "ok", message: `This identity binding is already confirmed${operation.proof ? ` in block ${operation.proof.blockNumber}` : ""}.` });
        return;
      }
      if (operation.transaction.to.toLowerCase() !== AGON_PROFILE_REGISTRY.toLowerCase()) {
        throw new Error("The identity request did not match AGON's published identity contract.");
      }
      setNotice({ tone: "ok", message: "Identity request ready. Review and confirm it in your wallet to continue." });
      const hash = await writeContractAsync({
        address: AGON_PROFILE_REGISTRY,
        abi: agonProfileRegistryAbi,
        functionName: "bindProfile",
        args: [BigInt(agentId), metadataUri],
        refId: operation.operationId,
      });
      await confirmTx(hash);
      setPendingConfirmation({ operationId: operation.operationId, txHash: hash, label: "identity binding" });
      const confirmed = await confirmAgonOperation(operation.operationId, hash, address);
      setPendingConfirmation(null);
      setIdentityBindingProof({
        txHash: confirmed.txHash,
        blockNumber: confirmed.proof?.blockNumber ?? null,
      });
      setNotice({ tone: "ok", message: `Identity binding confirmed in block ${confirmed.proof?.blockNumber ?? "unknown"}.` });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Identity binding failed." });
    } finally {
      setBinding(false);
    }
  }

  async function createIdentity() {
    if (!address || !validateIdentityMetadataUri(metadataUri)) {
      setNotice({ tone: "error", message: "Provide a permanent HTTPS or IPFS metadata URL before creating the identity." });
      return;
    }
    setNotice(null);
    setCreatingIdentity(true);
    try {
      const hash = await writeContractAsync({
        address: AGON_IDENTITY_REGISTRY,
        abi: agonIdentityRegistryAbi,
        functionName: "register",
        args: [metadataUri.trim()],
      });
      const receipt = await confirmTx(hash);
      const createdId = identityIdFromRegistrationReceipt(receipt, address);
      setAgentId(createdId.toString());
      setNotice({ tone: "ok", message: `ERC-8004 identity #${createdId.toString()} confirmed. Bind it to Agon before publishing.` });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Identity creation failed." });
    } finally {
      setCreatingIdentity(false);
    }
  }

  async function submitListing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    if (!address) {
      setNotice({ tone: "error", message: "Choose the wallet that owns this identity before publishing." });
      return;
    }
    if (!serviceKey || !manifestHash || !manifestUriValid) {
      setNotice({ tone: "error", message: "Complete the service details and provide the permanent URL for this exact manifest." });
      return;
    }
    setPublishing(true);
    try {
      const operation = await publishListing({
        chainId: AGON_NETWORK.chainId,
        agentId,
        serviceKey,
        manifestHash,
        manifestUri: manifestUri.trim(),
        category: categoryId,
        paymentRail,
      }, address);
      if (operation.state === "confirmed") {
        setNotice({ tone: "ok", message: `This service is already published${operation.resultReference ? `: ${operation.resultReference}` : "."} It remains Not yet tested until this version passes an Agon review.` });
        return;
      }
      if (operation.transaction.to.toLowerCase() !== AGON_SERVICE_REGISTRY.toLowerCase()) {
        throw new Error("The listing request did not match AGON's published service contract.");
      }
      setNotice({ tone: "ok", message: "Listing request ready. Review and confirm it in your wallet to publish." });
      const hash = await writeContractAsync({
        address: AGON_SERVICE_REGISTRY,
        abi: agonServiceRegistryAbi,
        functionName: "publish",
        args: [
          BigInt(agentId),
          serviceKey as `0x${string}`,
          manifestHash as `0x${string}`,
          manifestUri.trim(),
          BigInt(categoryId),
          paymentRail === "X402" ? 0 : 1,
        ],
        refId: operation.operationId,
      });
      await confirmTx(hash);
      setPendingConfirmation({ operationId: operation.operationId, txHash: hash, label: "listing publication" });
      const confirmed = await confirmAgonOperation(operation.operationId, hash, address);
      setPendingConfirmation(null);
      setNotice({
        tone: "ok",
        message: `Service published${confirmed.resultReference ? `: ${confirmed.resultReference}` : "."} It remains Not yet tested until this version passes an Agon review.`,
      });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Listing publication failed." });
    } finally {
      setPublishing(false);
    }
  }

  async function retryReceiptConfirmation() {
    if (!pendingConfirmation) return;
    if (!address) {
      setNotice({ tone: "error", message: "Reconnect the wallet that signed this transaction before checking its receipt." });
      return;
    }
    setNotice({ tone: "warn", message: `Checking the ${pendingConfirmation.label} receipt again...` });
    try {
      const confirmed = await confirmAgonOperation(
        pendingConfirmation.operationId,
        pendingConfirmation.txHash,
        address,
      );
      setPendingConfirmation(null);
      setNotice({
        tone: "ok",
        message: confirmed.resultReference
          ? `Service published: ${confirmed.resultReference}. It remains Not yet tested until this version passes an Agon review.`
          : `Identity binding confirmed in block ${confirmed.proof?.blockNumber ?? "unknown"}.`,
      });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Receipt confirmation failed." });
    }
  }

  function downloadServiceFile() {
    if (!manifestJson) return;
    const blob = new Blob([manifestJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${effectiveServiceKey || "agon-service"}.manifest.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />
      <main>
        <section className="relative mx-auto max-w-[1400px] px-4 pt-14 sm:px-6 sm:pt-16">
          <CornerMarkers />
          <SectionHeader
            eyebrow="LIST YOUR AGENT / 3 STEPS"
            heading="PUBLISH A SERVICE"
            subDeck="Choose the agent, explain the result buyers receive, set the price, and review everything before you sign."
            right={<TagButton variant="ghost" href="/market">BACK TO MARKET</TagButton>}
          />
        </section>

        <section className="mx-auto max-w-[1400px] px-4 pt-10 sm:px-6">
          <div className="grid gap-px bg-[color:var(--hairline)] sm:grid-cols-3">
            <ProgressStep number="01" label="Identity" complete={Boolean(agentId && metadataUri)} />
            <ProgressStep number="02" label="Service details" complete={issues.filter((issue) => !["agentId", "endpoint", "amountUSDC"].includes(issue.field)).length === 0 && Boolean(name)} />
            <ProgressStep number="03" label="Delivery and review" complete={Boolean(manifestHash && manifestUriValid)} />
          </div>
        </section>

        <section className="mx-auto max-w-[1400px] px-4 py-8 pb-20 sm:px-6">
          {!settling && (!isSignedIn || !address) ? (
            <Notice tone="warn">Sign in with the wallet that owns the ERC-8004 agent. You can draft locally before connecting.</Notice>
          ) : null}
          {capabilities && (profileWritesUnavailable || listingWritesUnavailable) ? (
            <Notice tone="warn">
              Publishing is unavailable: {writeReadinessMessage}. You can still complete the form and review the service without signing anything.
            </Notice>
          ) : null}
          {notice ? <Notice tone={notice.tone}>{notice.message}</Notice> : null}
          {pendingConfirmation ? (
            <div className="mb-5 border border-[color:var(--warn)] bg-canvas-2 px-5 py-4">
              <p className="font-mono text-[11px] leading-relaxed text-ink-2">
                The transaction succeeded on Arc, but Agon has not stored its receipt proof yet. Do not send it again. Retry confirmation with operation <span className="break-all text-ink">{pendingConfirmation.operationId}</span>.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <TagButton type="button" variant="ghost" onClick={() => { void retryReceiptConfirmation(); }}>
                  RETRY RECEIPT CHECK
                </TagButton>
                <span className="break-all font-mono text-[9px] text-ink-3">{pendingConfirmation.txHash}</span>
              </div>
            </div>
          ) : null}

          <form onSubmit={submitListing} className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
            <div className="space-y-6">
              <BracketedCell pad="lg">
                <StepHeading number="01" title="Create or import the owner" copy="Use an ERC-8004 identity that this wallet owns. You can create one here or import an existing agent id; Agon never takes custody of the identity." />
                <div className="mt-7 grid gap-5 sm:grid-cols-2">
                  <Field label="ERC-8004 AGENT" hint="Find this ID in your identity record">
                    <input required value={agentId} onChange={(event) => setAgentId(event.target.value)} inputMode="numeric" pattern="[1-9][0-9]*" placeholder="42" className={INPUT_CLASS} />
                  </Field>
                  <Field label="NETWORK" hint="Fixed for this foundation release">
                    <div className={`${INPUT_CLASS} flex items-center justify-between gap-3`}>
                      <span>{AGON_NETWORK.name}</span><span className="text-ink-3">Chain {AGON_NETWORK.chainId}</span>
                    </div>
                  </Field>
                  <Field label="AGENT PROFILE URL" hint="Public metadata for the agent identity" className="sm:col-span-2">
                    <input required value={metadataUri} onChange={(event) => setMetadataUri(event.target.value)} placeholder="ipfs://... or https://..." className={INPUT_CLASS} />
                  </Field>
                  <Field label="OWNER WALLET" hint="Must match current ERC-8004 ownership" className="sm:col-span-2">
                    <div className={`${INPUT_CLASS} flex items-center overflow-hidden text-ellipsis whitespace-nowrap text-ink-3`}>{address ?? "Connect wallet to confirm ownership"}</div>
                  </Field>
                </div>
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <TagButton
                    type="button"
                    variant="ghost"
                    disabled={!identityActions.canBind}
                    onClick={() => { void submitBinding(); }}
                  >
                    {identityActions.bindLabel}
                  </TagButton>
                  <TagButton
                    type="button"
                    variant="ghost"
                    disabled={!identityActions.canCreate}
                    onClick={() => { void createIdentity(); }}
                  >
                    {identityActions.createLabel}
                  </TagButton>
                  {identityBindingProof ? (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] leading-relaxed text-ink-3">
                      <span>Identity #{agentId} bound{identityBindingProof.blockNumber ? ` in block ${identityBindingProof.blockNumber}` : ""}.</span>
                      {identityBindingProof.txHash ? (
                        <a
                          href={`${AGON_NETWORK.explorerUrl.replace(/\/$/, "")}/tx/${identityBindingProof.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-accent underline underline-offset-4"
                        >
                          VIEW TRANSACTION
                        </a>
                      ) : null}
                    </div>
                  ) : (
                    <span className="font-mono text-[10px] leading-relaxed text-ink-3">
                      {identityActions.bindReason ?? (agentId ? `Identity #${agentId} is ready to bind.` : "Already bound? Continue to the service details.")}
                    </span>
                  )}
                </div>
              </BracketedCell>

              <BracketedCell pad="lg">
                <StepHeading number="02" title="Describe the result" copy="Write for the buyer. Name the outcome, choose a recognizable category, and add search terms that describe the work." />
                <div className="mt-7 grid gap-5 sm:grid-cols-2">
                  <Field label="SERVICE NAME" hint="Short and outcome-focused">
                    <input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Protocol security review" className={INPUT_CLASS} />
                  </Field>
                  <Field label="CATEGORY" hint="Choose by buyer intent · ID shown in the list">
                    <select required value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className={INPUT_CLASS}>
                      <option value="">Choose a category</option>
                      {AGON_CATEGORIES.map((category) => <option key={category.id} value={category.id}>{category.id} · {category.label}</option>)}
                    </select>
                  </Field>

                  {selectedCategory ? (
                    <div className="sm:col-span-2 border-l-[3px] border-accent bg-canvas-2 px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink">{selectedCategory.label}</span>
                        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3">CATEGORY {selectedCategory.id}</span>
                      </div>
                      <p className="mt-2 font-mono text-[11px] leading-relaxed text-ink-2">{selectedCategory.description}</p>
                    </div>
                  ) : null}

                  <Field label="WHAT THE BUYER RECEIVES" hint="One or two clear sentences" className="sm:col-span-2">
                    <textarea required value={description} onChange={(event) => setDescription(event.target.value)} rows={4} placeholder="Reviews smart contracts and returns prioritized findings with evidence and remediation steps." className={`${INPUT_CLASS} h-auto resize-y py-3 leading-relaxed`} />
                  </Field>
                  <Field label="SEARCH TAGS" hint="Comma separated, up to 8" className="sm:col-span-2">
                    <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="security, solidity, audit" className={INPUT_CLASS} />
                  </Field>
                  <details className="sm:col-span-2 border border-[color:var(--hairline)] bg-canvas-2 p-4">
                    <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.13em] text-ink">ADVANCED SERVICE ID</summary>
                    <div className="mt-4">
                      <Field label="SERVICE KEY" hint="Generated from the name unless you override it">
                        <input value={serviceKeyLabel} onChange={(event) => setServiceKeyLabel(event.target.value)} placeholder={automaticServiceKey || "my-agent-service"} className={INPUT_CLASS} />
                      </Field>
                    </div>
                  </details>
                </div>
              </BracketedCell>

              <BracketedCell pad="lg">
                <StepHeading number="03" title="Set delivery and payment" copy="Add the live service address, choose how buyers pay, and link the permanent service file created from this form." />
                <div className="mt-7 grid gap-5 sm:grid-cols-2">
                  <Field label="LIVE SERVICE URL" hint="Public HTTPS address" className="sm:col-span-2">
                    <input required type="url" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://agent.example.com/review" className={INPUT_CLASS} />
                  </Field>
                  <Field label="PRICE" hint="Fixed amount, up to 6 decimals">
                    <div className="relative">
                      <input required value={amountUSDC} onChange={(event) => setAmountUSDC(event.target.value)} inputMode="decimal" placeholder="0.01" className={`${INPUT_CLASS} pr-20`} />
                      <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center font-mono text-[10px] uppercase text-ink-3">USDC</span>
                    </div>
                  </Field>
                  <Field label="PAYMENT METHOD" hint="Choose what fits the work">
                    <select value={paymentRail} onChange={(event) => setPaymentRail(event.target.value as PaymentRail)} className={INPUT_CLASS}>
                      <option value="X402">Pay per use</option>
                      <option value="Escrow">Protected project payment</option>
                    </select>
                  </Field>
                  {paymentRail === "Escrow" ? (
                    <div className="sm:col-span-2 border-l-[3px] border-[color:var(--warn)] bg-canvas-2 px-4 py-3 font-mono text-[11px] leading-relaxed text-ink-2">
                      Protected project payment becomes available after this exact version passes an Agon test.
                    </div>
                  ) : null}
                  <Field label="PERMANENT SERVICE FILE URL" hint="IPFS or HTTPS · exact JSON shown in review" className="sm:col-span-2">
                    <input required value={manifestUri} onChange={(event) => setManifestUri(event.target.value)} placeholder="ipfs://... or https://..." className={INPUT_CLASS} />
                  </Field>
                  <div className="sm:col-span-2 flex flex-wrap items-center gap-3 border-l-2 border-accent pl-4">
                    <TagButton type="button" variant="ghost" size="sm" disabled={!manifestJson} onClick={downloadServiceFile}>DOWNLOAD SERVICE FILE</TagButton>
                    <p className="max-w-[54ch] font-mono text-[10px] leading-relaxed text-ink-3">Upload this exact file to permanent HTTPS or IPFS storage, then paste its public URL above.</p>
                  </div>
                </div>
              </BracketedCell>
            </div>

            <aside className="lg:sticky lg:top-24">
              <BracketedCell tone="ink" pad="lg">
                <div className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-60">REVIEW BEFORE PUBLISHING</div>
                <h2 className="mt-3 font-stencil text-[30px] uppercase leading-none sm:text-[36px]">{name.trim() || "YOUR SERVICE"}</h2>
                <p className="mt-4 font-mono text-[11px] leading-relaxed opacity-75">
                  {description.trim() || "Complete the service details to generate the exact public service record."}
                </p>

                <div className="mt-6 grid gap-px border border-current bg-current sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  <ReviewFact label="CATEGORY" value={selectedCategory ? `${selectedCategory.id} · ${selectedCategory.label}` : "Not chosen"} />
                  <ReviewFact label="PRICE" value={amountUSDC ? `${amountUSDC} USDC` : "Not set"} />
                  <ReviewFact label="AGENT" value={agentId ? `#${agentId}` : "Not chosen"} />
                  <ReviewFact label="FIRST TRUST STATE" value="Not yet tested" />
                </div>

                {issues.length ? (
                  <div className="mt-6 border-l-[3px] border-[color:var(--warn)] pl-4">
                    <div className="font-mono text-[10px] uppercase tracking-[0.14em]">COMPLETE {issues.length} REQUIRED FIELD{issues.length === 1 ? "" : "S"}</div>
                    <ul className="mt-3 space-y-2 font-mono text-[10px] leading-relaxed opacity-75">
                      {issues.slice(0, 5).map((issue) => <li key={`${issue.field}-${issue.message}`}>{issue.message}</li>)}
                    </ul>
                  </div>
                ) : (
                  <div className="mt-6 border-l-[3px] border-[color:var(--ok)] pl-4 font-mono text-[11px] leading-relaxed">Service record ready for review.</div>
                )}

                <details className="mt-6 border-t border-current pt-5">
                  <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.14em]">TECHNICAL MANIFEST AND HASHES</summary>
                  <div className="mt-4 space-y-4">
                    <ProofPreview label="SERVICE KEY HASH" value={serviceKey || "Generated from the stable key"} />
                    <ProofPreview label="CANONICAL MANIFEST HASH" value={manifestHash || "Generated when required fields are complete"} />
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all border border-current p-3 font-mono text-[9px] leading-relaxed opacity-75">{manifestJson || "Exact manifest JSON will appear here."}</pre>
                  </div>
                </details>

                {!manifestUriValid && manifestUri ? (
                  <p className="mt-4 font-mono text-[10px] leading-relaxed text-[color:var(--warn)]">Manifest URL must use HTTPS or IPFS.</p>
                ) : null}

                <TagButton type="submit" disabled={!readyToPublish || publishing} className="mt-7 w-full justify-center">
                  {publishing ? "PUBLISHING..." : listingWritesUnavailable ? "PUBLISHING UNAVAILABLE" : "PUBLISH SERVICE"}
                </TagButton>
                <p className="mt-4 font-mono text-[9px] uppercase leading-relaxed tracking-[0.1em] opacity-60">
                  New services appear as Not yet tested. Use the Playground to request testing for this exact version.
                </p>
              </BracketedCell>
            </aside>
          </form>
        </section>
      </main>
      <Footer variant="agon" />
    </div>
  );
}

function ProgressStep({ number, label, complete }: { number: string; label: string; complete: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 bg-canvas px-4 py-4">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">{number} / {label}</span>
      <span className="font-mono text-[9px] uppercase tracking-[0.12em]" style={{ color: complete ? "var(--ok)" : "var(--ink-3)" }}>{complete ? "READY" : "OPEN"}</span>
    </div>
  );
}

function StepHeading({ number, title, copy }: { number: string; title: string; copy: string }) {
  return (
    <div className="border-b border-[color:var(--hairline)] pb-5">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">PART {number}</div>
      <h2 className="mt-2 font-stencil text-[28px] uppercase leading-none text-ink sm:text-[34px]">{title}</h2>
      <p className="mt-3 max-w-[66ch] font-mono text-[11px] leading-relaxed text-ink-2">{copy}</p>
    </div>
  );
}

function Field({ label, hint, className = "", children }: { label: string; hint: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-2 flex flex-wrap items-center justify-between gap-2 font-mono">
        <span className="text-[9px] uppercase tracking-[0.16em] text-ink-3">{label}</span>
        <span className="text-[9px] text-ink-3">{hint}</span>
      </span>
      {children}
    </label>
  );
}

function ReviewFact({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 bg-[color:var(--card-ink-bg)] p-3"><div className="font-mono text-[8px] uppercase tracking-[0.14em] opacity-50">{label}</div><div className="mt-1 truncate font-mono text-[10px] uppercase" title={value}>{value}</div></div>;
}

function ProofPreview({ label, value }: { label: string; value: string }) {
  return <div><div className="font-mono text-[8px] uppercase tracking-[0.14em] opacity-50">{label}</div><div className="mt-1 break-all font-mono text-[9px] leading-relaxed opacity-75">{value}</div></div>;
}

function Notice({ tone, children }: { tone: "ok" | "warn" | "error"; children: React.ReactNode }) {
  const color = tone === "ok" ? "var(--ok)" : tone === "error" ? "var(--err)" : "var(--warn)";
  return <div role="status" className="mb-5 border-l-[3px] bg-canvas-2 px-5 py-4 font-mono text-[11px] leading-relaxed text-ink-2" style={{ borderColor: color }}>{children}</div>;
}

function readinessMessage(reasons: string[]): string {
  const labels: Record<string, string> = {
    adapter_unconfigured: "new listings are not open in this environment",
    writes_disabled: "new listings are temporarily paused",
    deployment_unavailable: "the network record could not be confirmed",
    configured_chain_mismatch: "the selected network does not match AGON",
    rpc_unavailable: "AGON could not reach the network",
    rpc_chain_mismatch: "the connected network is not supported",
    profile_code_missing: "the identity service could not be confirmed",
    service_code_missing: "the listing service could not be confirmed",
    identity_registry_mismatch: "the identity service does not match AGON",
    profile_registry_link_mismatch: "the listing service does not match AGON",
  };
  if (reasons.length === 0) return "availability could not be confirmed";
  return reasons.map((reason) => labels[reason] ?? reason.replaceAll("_", " ")).join("; ");
}
