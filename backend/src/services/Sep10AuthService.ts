const { createHash } = require("crypto");
const { Keypair, Networks, WebAuth } = require("stellar-sdk");
const cacheService = require("./cacheService");

export interface ChallengeRecord {
  account: string;
  nonce: string;
  txHash: string;
}

export interface ChallengeStore {
  isReady?: () => boolean;
  set: (key: string, value: ChallengeRecord, ttl: number) => Promise<boolean>;
  consume: (key: string) => Promise<ChallengeRecord | null>;
}

export interface Sep10AuthOptions {
  challengeStore?: ChallengeStore;
  serverSigningSeed?: string;
  homeDomain?: string;
  webAuthDomain?: string;
  networkPassphrase?: string;
}

export class Sep10AuthError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "Sep10AuthError";
    this.code = code;
    this.status = status;
  }
}

export class Sep10AuthService {
  private readonly challengeStore: ChallengeStore;
  private readonly serverSigningSeed?: string;
  private readonly homeDomain?: string;
  private readonly webAuthDomain?: string;
  private readonly networkPassphrase: string;
  private readonly challengeTtlSeconds = 300;

  constructor(options: Sep10AuthOptions = {}) {
    this.challengeStore = options.challengeStore || cacheService;
    this.serverSigningSeed =
      options.serverSigningSeed || process.env.SEP10_SIGNING_SEED;
    this.homeDomain =
      options.homeDomain ||
      process.env.SEP10_HOME_DOMAIN ||
      (process.env.NODE_ENV === "production" ? undefined : "localhost");
    this.webAuthDomain =
      options.webAuthDomain ||
      process.env.SEP10_WEB_AUTH_DOMAIN ||
      this.homeDomain;
    this.networkPassphrase =
      options.networkPassphrase ||
      process.env.STELLAR_NETWORK_PASSPHRASE ||
      Networks.TESTNET;
  }

  getNetworkPassphrase(): string {
    return this.networkPassphrase;
  }

  private getServerKeypair() {
    if (!this.serverSigningSeed) {
      throw new Sep10AuthError(
        "sep10_not_configured",
        "SEP10_SIGNING_SEED is required for Stellar wallet authentication",
        503,
      );
    }

    try {
      return Keypair.fromSecret(this.serverSigningSeed);
    } catch {
      throw new Sep10AuthError(
        "sep10_not_configured",
        "SEP10_SIGNING_SEED is not a valid Stellar signing seed",
        503,
      );
    }
  }

  private getDomains(): { homeDomain: string; webAuthDomain: string } {
    if (!this.homeDomain || !this.webAuthDomain) {
      throw new Sep10AuthError(
        "sep10_not_configured",
        "SEP10_HOME_DOMAIN and SEP10_WEB_AUTH_DOMAIN must be configured",
        503,
      );
    }

    return {
      homeDomain: this.homeDomain,
      webAuthDomain: this.webAuthDomain,
    };
  }

  private assertStoreReady() {
    if (
      typeof this.challengeStore.isReady === "function" &&
      !this.challengeStore.isReady()
    ) {
      throw new Sep10AuthError(
        "sep10_replay_store_unavailable",
        "SEP-10 authentication is temporarily unavailable because Redis is not ready",
        503,
      );
    }
  }

  private extractNonce(tx: any): string {
    const firstOperation = tx.operations && tx.operations[0];
    if (
      !firstOperation ||
      firstOperation.type !== "manageData" ||
      !firstOperation.value
    ) {
      throw new Sep10AuthError(
        "invalid_challenge",
        "SEP-10 challenge does not contain a nonce",
        401,
      );
    }

    return Buffer.from(firstOperation.value).toString();
  }

  private nonceKey(nonce: string): string {
    const digest = createHash("sha256").update(nonce).digest("hex");
    return `sep10:challenge:${digest}`;
  }

  async createChallenge(account: string) {
    if (typeof account !== "string" || !account.startsWith("G")) {
      throw new Sep10AuthError(
        "invalid_account",
        "A valid Stellar G... account is required",
        400,
      );
    }

    try {
      Keypair.fromPublicKey(account);
    } catch {
      throw new Sep10AuthError(
        "invalid_account",
        "A valid Stellar G... account is required",
        400,
      );
    }

    this.assertStoreReady();

    const serverKeypair = this.getServerKeypair();
    const { homeDomain, webAuthDomain } = this.getDomains();

    const transaction = WebAuth.buildChallengeTx(
      serverKeypair,
      account,
      homeDomain,
      this.challengeTtlSeconds,
      this.networkPassphrase,
      webAuthDomain,
    );

    const details = WebAuth.readChallengeTx(
      transaction,
      serverKeypair.publicKey(),
      this.networkPassphrase,
      homeDomain,
      webAuthDomain,
    );

    const nonce = this.extractNonce(details.tx);
    const txHash = details.tx.hash().toString("hex");
    const stored = await this.challengeStore.set(
      this.nonceKey(nonce),
      { account, nonce, txHash },
      this.challengeTtlSeconds,
    );

    if (!stored) {
      throw new Sep10AuthError(
        "sep10_replay_store_unavailable",
        "Unable to persist SEP-10 challenge replay state",
        503,
      );
    }

    return {
      transaction,
      networkPassphrase: this.networkPassphrase,
      expiresIn: this.challengeTtlSeconds,
    };
  }

  async verifyChallenge(signedTransaction: string) {
    if (!signedTransaction || typeof signedTransaction !== "string") {
      throw new Sep10AuthError(
        "invalid_challenge",
        "A signed SEP-10 transaction is required",
        400,
      );
    }

    this.assertStoreReady();

    const serverKeypair = this.getServerKeypair();
    const { homeDomain, webAuthDomain } = this.getDomains();

    let details: any;
    let verifiedSigners: string[];

    try {
      details = WebAuth.readChallengeTx(
        signedTransaction,
        serverKeypair.publicKey(),
        this.networkPassphrase,
        homeDomain,
        webAuthDomain,
      );

      verifiedSigners = WebAuth.verifyChallengeTxSigners(
        signedTransaction,
        serverKeypair.publicKey(),
        this.networkPassphrase,
        [details.clientAccountID],
        homeDomain,
        webAuthDomain,
      );
    } catch (error: any) {
      throw new Sep10AuthError(
        "invalid_challenge",
        error && error.message
          ? `SEP-10 challenge verification failed: ${error.message}`
          : "SEP-10 challenge verification failed",
        401,
      );
    }

    if (!verifiedSigners.includes(details.clientAccountID)) {
      throw new Sep10AuthError(
        "invalid_challenge",
        "SEP-10 challenge is missing the client account signature",
        401,
      );
    }

    const nonce = this.extractNonce(details.tx);
    const txHash = details.tx.hash().toString("hex");
    let record: ChallengeRecord | null;
    try {
      record = await this.challengeStore.consume(this.nonceKey(nonce));
    } catch {
      throw new Sep10AuthError(
        "sep10_replay_store_unavailable",
        "Unable to atomically consume SEP-10 challenge replay state",
        503,
      );
    }

    if (!record) {
      throw new Sep10AuthError(
        "challenge_replayed_or_expired",
        "SEP-10 challenge has already been used or has expired",
        401,
      );
    }

    if (
      record.account !== details.clientAccountID ||
      record.nonce !== nonce ||
      record.txHash !== txHash
    ) {
      throw new Sep10AuthError(
        "invalid_challenge",
        "SEP-10 challenge does not match the issued replay record",
        401,
      );
    }

    return {
      account: details.clientAccountID,
      matchedHomeDomain: details.matchedHomeDomain,
    };
  }
}

export const sep10AuthService = new Sep10AuthService();
