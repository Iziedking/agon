"use client";

import { useEffect, useRef, useState } from "react";
import { BracketedCell, TagButton } from "@/components/redesign";
import { useAuth } from "@/hooks/useAuth";
import {
  createCircleUserControlledDevice,
  fetchCircleUserControlledConfig,
  linkCircleUserControlledWallet,
  prepareCircleUserControlledWallet,
  type CircleUserControlledConfig,
  type CircleUserControlledWallet,
} from "@/lib/auth";
import { registerCircleUserControlledSession, type CircleSdk } from "@/lib/circle-user-controlled";

type OnboardingSdk = CircleSdk & {
  getDeviceId(): Promise<string>;
  updateConfigs(configs: unknown, onLoginComplete?: (error: unknown, result: unknown) => void): void;
  verifyOtp(): void;
};

type CircleLoginResult = { userToken: string; encryptionKey: string };

function isLoginResult(value: unknown): value is CircleLoginResult {
  const result = value as Partial<CircleLoginResult> | null;
  return typeof result?.userToken === "string" && typeof result.encryptionKey === "string";
}

export function CircleUserControlledWalletPanel() {
  const { me, refresh } = useAuth();
  const [config, setConfig] = useState<CircleUserControlledConfig | null>(null);
  const [email, setEmail] = useState(me?.email ?? "");
  const [status, setStatus] = useState("loading configuration");
  const [busy, setBusy] = useState(false);
  const [userToken, setUserToken] = useState<string | null>(null);
  const [wallets, setWallets] = useState<CircleUserControlledWallet[]>([]);
  const sessionRef = useRef<{ sdk: CircleSdk; userToken: string; encryptionKey: string } | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchCircleUserControlledConfig()
      .then((value) => {
        if (alive) {
          setConfig(value);
          setStatus(value.enabled ? "ready" : "disabled on this environment");
        }
      })
      .catch(() => alive && setStatus("configuration unavailable"));
    return () => {
      alive = false;
    };
  }, []);

  async function loadWallets(token: string, currentSdk: CircleSdk, currentEncryptionKey: string) {
    const prepared = await prepareCircleUserControlledWallet(token);
    if (prepared.challengeId) {
      currentSdk.setAuthentication({ userToken: token, encryptionKey: currentEncryptionKey });
      await new Promise<void>((resolve, reject) => {
        currentSdk.execute(prepared.challengeId!, (error) => (error ? reject(new Error("wallet setup was not completed")) : resolve()));
      });
      const after = await prepareCircleUserControlledWallet(token);
      setWallets(after.wallets);
      return;
    }
    setWallets(prepared.wallets);
  }

  async function startEmailOnboarding() {
    if (!config?.enabled || !config.appId) return;
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setStatus("enter a valid email address");
      return;
    }
    setBusy(true);
    setStatus("sending Circle verification code");
    try {
      const { W3SSdk } = await import("@circle-fin/w3s-pw-web-sdk");
      const nextSdk = new W3SSdk({ appSettings: { appId: config.appId } }, async (error, result) => {
        if (error || !isLoginResult(result)) {
          setBusy(false);
          setStatus("Circle verification was not completed");
          return;
        }
        try {
          setStatus("preparing your Arc wallet");
          setUserToken(result.userToken);
          sessionRef.current = { sdk: nextSdk, userToken: result.userToken, encryptionKey: result.encryptionKey };
          await loadWallets(result.userToken, nextSdk, result.encryptionKey);
          setBusy(false);
          setStatus("wallet ready to link");
        } catch {
          setBusy(false);
          setStatus("wallet setup failed; retry without resending a transaction");
        }
      }) as unknown as OnboardingSdk;
      const deviceId = await nextSdk.getDeviceId();
      const device = await createCircleUserControlledDevice({ deviceId, email: normalizedEmail });
      nextSdk.updateConfigs({
        appSettings: { appId: config.appId },
        loginConfigs: {
          deviceToken: device.deviceToken,
          deviceEncryptionKey: device.deviceEncryptionKey,
          ...(device.otpToken ? { otpToken: device.otpToken } : {}),
        },
      });
      setStatus("complete the Circle email verification");
      nextSdk.verifyOtp();
    } catch (error) {
      setBusy(false);
      setStatus(error instanceof Error ? error.message : "Circle onboarding failed");
    }
  }

  async function linkWallet(wallet: CircleUserControlledWallet) {
    if (!userToken) return;
    setBusy(true);
    setStatus("linking wallet principal");
    try {
      await linkCircleUserControlledWallet({ userToken, walletId: wallet.id, address: wallet.address });
      const current = sessionRef.current;
      if (current) {
        registerCircleUserControlledSession({ ...current, walletId: wallet.id, address: wallet.address });
      }
      setUserToken(null);
      setWallets([]);
      setBusy(false);
      setStatus("linked; browser-controlled approvals are now visible in your session");
      await refresh();
    } catch (error) {
      setBusy(false);
      setStatus(error instanceof Error ? error.message : "wallet link failed");
    }
  }

  return (
    <BracketedCell pad="md" className="mb-6">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">USER-CONTROLLED WALLET</div>
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-3">
        <div className="font-stencil text-2xl uppercase">LINK A CIRCLE WALLET</div>
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">NO SERVER KEY CUSTODY</div>
      </div>
      <p className="mt-3 max-w-[72ch] font-mono text-[11px] leading-relaxed text-ink-2">
        Use Circle email verification to create or load a browser-controlled wallet. Agon stores only the wallet identity and provider references. Signing remains in Circle&apos;s user-controlled browser surface.
      </p>
      {!me ? (
        <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.1em] text-ink-3">sign in to Agon before linking another wallet principal</p>
      ) : config?.enabled ? (
        <div className="mt-5 flex flex-wrap items-end gap-3">
          <label className="min-w-[260px] flex-1">
            <span className="mb-2 block font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Circle email</span>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              autoComplete="email"
              disabled={busy}
              className="w-full border border-[color:var(--hairline-strong)] bg-canvas px-3 py-2 font-mono text-[12px] text-ink outline-none focus:border-accent"
              placeholder="you@example.com"
            />
          </label>
          <TagButton type="button" onClick={() => void startEmailOnboarding()} disabled={busy}>
            {busy ? "WORKING..." : "VERIFY WITH CIRCLE"}
          </TagButton>
        </div>
      ) : null}
      <div className="mt-4 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">status: {status}</div>
      {wallets.length > 0 ? (
        <div className="mt-5 space-y-3">
          {wallets.map((wallet) => (
            <div key={wallet.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--hairline)] pt-3">
              <div>
                <div className="font-mono text-[11px] text-ink">{wallet.address}</div>
                <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">{wallet.blockchain} / {wallet.custodyType}</div>
              </div>
              <TagButton type="button" onClick={() => void linkWallet(wallet)} disabled={busy}>LINK PRINCIPAL</TagButton>
            </div>
          ))}
        </div>
      ) : null}
    </BracketedCell>
  );
}
