import { createWalletClient, http } from "viem";
import type { Account, Hash, WalletClient, WriteContractParameters } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { arcTestnet, publicClient } from "../chain/arc.js";
import { config } from "../config/index.js";

/// Submits coordinator transactions to Arc. Calls are serialized through a
/// promise chain so concurrent settlements never collide on the nonce; viem
/// reads the pending nonce per call and viem's EIP-1559 estimation respects
/// Arc's base fee. For higher throughput this can move to a windowed
/// nonce manager; serialized submission is correct and simple.
export class TxSender {
  readonly account: Account;
  private readonly wallet: WalletClient;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(privateKey: string) {
    const pk = (privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`) as `0x${string}`;
    this.account = privateKeyToAccount(pk);
    this.wallet = createWalletClient({ account: this.account, chain: arcTestnet, transport: http(config.rpcHttp) });
  }

  /// Pending nonce for the coordinator account.
  pendingNonce(): Promise<number> {
    return publicClient.getTransactionCount({ address: this.account.address, blockTag: "pending" });
  }

  /// Current EIP-1559 fee suggestion from Arc.
  fees() {
    return publicClient.estimateFeesPerGas();
  }

  /// Serialized contract write that waits for the receipt before resolving.
  send(params: WriteContractParameters): Promise<Hash> {
    const run = this.chain.then(async () => {
      const hash = await this.wallet.writeContract(params as never);
      await publicClient.waitForTransactionReceipt({ hash });
      return hash;
    });
    // Keep the chain alive regardless of individual failures.
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
