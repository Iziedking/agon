import Link from "next/link";
import { BNB_MARKET_CONFIG } from "@/lib/bnb/feature-flags";
import { BNB_TESTNET_ID, type BnbChainId } from "@/lib/bnb/chains";
import type { BnbService } from "@/lib/bnb/catalog";

type StepStatus = "done" | "blocked" | "blocked-soft";

interface ActivationPanelProps {
  service: BnbService;
  chainId: BnbChainId;
}

const Step = ({
  status,
  title,
  body,
  actionLabel,
  actionHref,
  disabled,
}: {
  status: StepStatus;
  title: string;
  body: string;
  actionLabel: string;
  actionHref: string;
  disabled?: boolean;
}) => {
  const tone = status === "done" ? "text-[color:var(--ok)]" : status === "blocked" ? "text-[color:var(--err)]" : "text-[color:var(--warn)]";

  return (
    <li className="rounded-sm border border-[color:var(--hairline)] bg-[color:var(--canvas-2)] p-4">
      <p className="text-[11px] uppercase tracking-[0.14em] text-[color:var(--ink-3)]">Step</p>
      <p className={`mt-1 text-sm font-semibold ${tone}`}>{title}</p>
      <p className="mt-2 text-sm text-[color:var(--ink-2)]">{body}</p>
      <Link
        href={actionHref}
        aria-disabled={disabled}
        className={`mt-3 inline-flex h-10 items-center rounded-sm border px-3 text-xs uppercase tracking-[0.13em] ${
          disabled
            ? "border-[color:var(--hairline-strong)] text-[color:var(--ink-3)] opacity-60"
            : "border-[color:var(--hairline-strong)]"
        }`}
      >
        {actionLabel}
      </Link>
    </li>
  );
};

export function ActivationPanel({ service, chainId }: ActivationPanelProps) {
  const canActivate =
    BNB_MARKET_CONFIG.DEFAULT_ACTIVATION_ENABLED && service.active && service.proof.endpointStatus === "live";
  const onTestnet = chainId === BNB_TESTNET_ID;

  const proofReady = service.active && service.proof.endpointStatus === "live";
  const authorityReady = Boolean(service.authorityNeed && service.authorityNeed !== "TBD");
  const sessionReady = service.supportsTestJob || service.supportsRevoke;

  const evidenceStatus: StepStatus = proofReady ? "done" : "blocked-soft";
  const authorityStatus: StepStatus = authorityReady ? "done" : "blocked";
  const activateStatus: StepStatus = canActivate ? "done" : sessionReady ? "blocked-soft" : "blocked";

  return (
    <section className="space-y-3 rounded-sm border border-[color:var(--hairline-strong)] p-4">
      <h3 className="text-lg font-semibold">Activation path</h3>
      <p className="text-sm text-[color:var(--ink-2)]">
        Follow this sequence exactly on this page. A blocked state means the app only
        shows it for review.
      </p>
      <ul className="mt-4 space-y-3">
        <Step
          status={evidenceStatus}
          title={proofReady ? "Evidence confirmed" : "Evidence not currently sufficient"}
          body={
            proofReady
              ? "Endpoint and proof checks passed for the selected chain."
              : "Endpoint status is unknown or stale; open the evidence details before any action."
          }
          actionLabel="Review evidence"
          actionHref="#agent-evidence"
        />
        <Step
          status={authorityStatus}
          title={authorityReady ? "Authority scope available" : "Authority scope missing"}
          body={
            authorityReady
              ? `Authority requested: ${service.authorityNeed}. Scope: ${service.authorityScope || "explicit scope not declared"}.`
              : "Authority scope is too vague for safe review. Do not activate yet."
          }
          actionLabel="Open authority details"
          actionHref="#authority"
        />
        <Step
          status={activateStatus}
          title={canActivate ? "Activation ready" : "Activation blocked"}
          body={
            canActivate
              ? onTestnet
                ? "Testnet path is allowed and will use dry-run policy."
                : "Mainnet path is available after a live prepared session and explicit approval."
              : sessionReady
                ? "Session and signing integration is not connected yet."
                : "Activation controls are intentionally disabled in this branch."
          }
          actionLabel={canActivate ? "Proceed to run" : "Connect wallet + config"}
          actionHref="/market/new"
          disabled={!canActivate}
        />
      </ul>
    </section>
  );
}
