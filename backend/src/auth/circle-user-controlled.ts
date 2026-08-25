import {
  initiateUserControlledWalletsClient,
  type CircleUserControlledWalletsClient,
  type ClientParams,
} from "@circle-fin/user-controlled-wallets";

export type CircleUserControlledWallet = {
  id: string;
  address: string;
  blockchain: string;
  custodyType: string;
  userId?: string;
  state?: string;
};

export type CircleUserControlledClientLike = Pick<
  CircleUserControlledWalletsClient,
  "createDeviceTokenForEmailLogin" | "getUserStatus" | "createWallet" | "listWallets"
>;

export type CircleUserControlledService = {
  enabled: boolean;
  createDeviceToken(input: { deviceId: string; email: string }): Promise<{
    deviceToken: string;
    deviceEncryptionKey: string;
    otpToken?: string;
  }>;
  prepareWallet(input: { userToken: string }): Promise<{
    challengeId: string | null;
    userId: string | null;
    wallets: CircleUserControlledWallet[];
  }>;
  listWallets(input: { userToken: string }): Promise<CircleUserControlledWallet[]>;
  findOwnedWallet(input: { userToken: string; walletId: string; address: string }): Promise<CircleUserControlledWallet>;
};

type ServiceOptions = {
  enabled: boolean;
  apiKey?: string;
  baseUrl: string;
  blockchain: string;
  client?: CircleUserControlledClientLike;
};

function cleanToken(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length < 8 || value.length > 4096) {
    throw new Error(`${label} missing or invalid`);
  }
  return value;
}

function cleanWallet(value: unknown): CircleUserControlledWallet {
  const wallet = value as Partial<CircleUserControlledWallet>;
  if (
    typeof wallet.id !== "string" ||
    typeof wallet.address !== "string" ||
    typeof wallet.blockchain !== "string" ||
    typeof wallet.custodyType !== "string"
  ) {
    throw new Error("Circle returned an invalid wallet");
  }
  return {
    id: wallet.id,
    address: wallet.address,
    blockchain: wallet.blockchain,
    custodyType: wallet.custodyType,
    userId: typeof wallet.userId === "string" ? wallet.userId : undefined,
    state: typeof wallet.state === "string" ? wallet.state : undefined,
  };
}

function sanitizedWallets(input: unknown): CircleUserControlledWallet[] {
  const data = input as { data?: { wallets?: unknown[] } } | undefined;
  return Array.isArray(data?.data?.wallets) ? data.data.wallets.map(cleanWallet) : [];
}

export function createCircleUserControlledService(options: ServiceOptions): CircleUserControlledService {
  const enabled = Boolean(options.enabled && options.apiKey);
  let client: CircleUserControlledClientLike | undefined = options.client;
  const getClient = (): CircleUserControlledClientLike => {
    if (!enabled) throw new Error("Circle user-controlled wallets are disabled");
    if (!client) {
      const params: ClientParams = { apiKey: options.apiKey!, baseUrl: options.baseUrl };
      client = initiateUserControlledWalletsClient(params);
    }
    return client;
  };

  return {
    enabled,
    async createDeviceToken(input) {
      const response = await getClient().createDeviceTokenForEmailLogin({
        deviceId: cleanToken(input.deviceId, "device id"),
        email: input.email,
      });
      const data = response.data;
      return {
        deviceToken: cleanToken(data?.deviceToken, "device token"),
        deviceEncryptionKey: cleanToken(data?.deviceEncryptionKey, "device encryption key"),
        otpToken: typeof data?.otpToken === "string" ? data.otpToken : undefined,
      };
    },
    async prepareWallet(input) {
      const userToken = cleanToken(input.userToken, "user token");
      const api = getClient();
      const [status, listed] = await Promise.all([
        api.getUserStatus({ userToken }),
        api.listWallets({ userToken }),
      ]);
      const wallets = sanitizedWallets(listed);
      if (wallets.length > 0) {
        return {
          challengeId: null,
          userId: typeof status.data?.id === "string" ? status.data.id : wallets.at(0)?.userId ?? null,
          wallets,
        };
      }
      const created = await api.createWallet({
        userToken,
        blockchains: [options.blockchain as never],
      });
      const challengeId = created.data?.challengeId;
      if (typeof challengeId !== "string" || challengeId.length < 8) throw new Error("Circle did not return a wallet challenge");
      return {
        challengeId,
        userId: typeof status.data?.id === "string" ? status.data.id : null,
        wallets: [],
      };
    },
    async listWallets(input) {
      return sanitizedWallets(await getClient().listWallets({ userToken: cleanToken(input.userToken, "user token") }));
    },
    async findOwnedWallet(input) {
      const walletId = cleanToken(input.walletId, "wallet id");
      const address = input.address.trim().toLowerCase();
      const wallet = (await this.listWallets({ userToken: input.userToken })).find(
        (candidate) => candidate.id === walletId && candidate.address.toLowerCase() === address,
      );
      if (!wallet) throw new Error("Circle wallet ownership could not be verified");
      if (wallet.userId) return wallet;
      const status = await getClient().getUserStatus({ userToken: cleanToken(input.userToken, "user token") });
      const userId = status.data?.id;
      if (typeof userId !== "string" || userId.length < 1) throw new Error("Circle wallet has no provider user identity");
      return { ...wallet, userId };
    },
  };
}
