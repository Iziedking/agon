import type { Pool } from "pg";

export type StoredWalletPrincipal = {
  address: string;
  principalType: "circle_user_controlled";
  providerUserId: string | null;
  providerWalletId: string | null;
  blockchain: string | null;
  status: "active" | "unlinked" | "pending";
  linkedAt: string;
};

type WalletPrincipalRow = {
  address: string;
  principal_type: "circle_user_controlled";
  provider_user_id: string | null;
  provider_wallet_id: string | null;
  blockchain: string | null;
  status: "active" | "unlinked" | "pending";
  created_at: string;
};

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

export async function listWalletPrincipals(operatorAddress: string, database: Pool): Promise<StoredWalletPrincipal[]> {
  const result = await database.query<WalletPrincipalRow>(
    `select address, principal_type, provider_user_id, provider_wallet_id,
            blockchain, status, created_at
       from agon_wallet_principals
      where operator_address = $1 and status = 'active'
      order by created_at asc`,
    [normalizeAddress(operatorAddress)],
  );
  return result.rows.map((row) => ({
    address: row.address,
    principalType: row.principal_type,
    providerUserId: row.provider_user_id,
    providerWalletId: row.provider_wallet_id,
    blockchain: row.blockchain,
    status: row.status,
    linkedAt: row.created_at,
  }));
}

export type LinkCircleUserControlledWalletInput = {
  operatorAddress: string;
  address: string;
  providerUserId: string;
  providerWalletId: string;
  blockchain: string;
};

export async function linkCircleUserControlledWallet(
  input: LinkCircleUserControlledWalletInput,
  database: Pool,
): Promise<StoredWalletPrincipal> {
  const operatorAddress = normalizeAddress(input.operatorAddress);
  const address = normalizeAddress(input.address);
  const client = await database.connect();
  try {
    await client.query("begin");

    const existingAddress = await client.query<{ operator_address: string; provider_user_id: string | null }>(
      `select operator_address, provider_user_id
         from agon_wallet_principals
        where principal_type = 'circle_user_controlled' and address = $1
        for update`,
      [address],
    );
    const addressOwner = existingAddress.rows[0];
    if (addressOwner && addressOwner.operator_address.toLowerCase() !== operatorAddress) {
      throw new Error("wallet principal is already linked to another operator");
    }
    if (addressOwner?.provider_user_id && addressOwner.provider_user_id !== input.providerUserId) {
      throw new Error("wallet principal provider identity mismatch");
    }

    const existingWallet = await client.query<{ operator_address: string; address: string }>(
      `select operator_address, address
         from agon_wallet_principals
        where principal_type = 'circle_user_controlled' and provider_wallet_id = $1
        for update`,
      [input.providerWalletId],
    );
    const walletOwner = existingWallet.rows[0];
    if (walletOwner && walletOwner.operator_address.toLowerCase() !== operatorAddress) {
      throw new Error("provider wallet is already linked to another operator");
    }
    if (walletOwner && walletOwner.address !== address) {
      throw new Error("provider wallet address mismatch");
    }

    await client.query("insert into operators (address) values ($1) on conflict (address) do nothing", [operatorAddress]);
    const inserted = await client.query<WalletPrincipalRow>(
      `insert into agon_wallet_principals
        (operator_address, principal_type, address, provider_user_id, provider_wallet_id, blockchain, status)
       values ($1, 'circle_user_controlled', $2, $3, $4, $5, 'active')
       on conflict (principal_type, address) do update
         set provider_user_id = excluded.provider_user_id,
             provider_wallet_id = excluded.provider_wallet_id,
             blockchain = excluded.blockchain,
             status = 'active',
             updated_at = now()
       returning address, principal_type, provider_user_id, provider_wallet_id,
                 blockchain, status, created_at`,
      [operatorAddress, address, input.providerUserId, input.providerWalletId, input.blockchain],
    );
    await client.query("commit");
    const row = inserted.rows[0];
    if (!row) throw new Error("wallet principal was not persisted");
    return {
      address: row.address,
      principalType: row.principal_type,
      providerUserId: row.provider_user_id,
      providerWalletId: row.provider_wallet_id,
      blockchain: row.blockchain,
      status: row.status,
      linkedAt: row.created_at,
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
