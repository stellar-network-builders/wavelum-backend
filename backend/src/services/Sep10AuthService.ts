import { Keypair, Networks, WebAuth, StrKey, TransactionBuilder } from '@stellar/stellar-sdk';
import jwt from 'jsonwebtoken';
import Redis from 'ioredis';
import crypto from 'crypto';

export interface Sep10ChallengeResponse {
  transaction: string;
  networkPassphrase: string;
}

export interface Sep10TokenPayload {
  iss: string;
  sub: string;
  iat: number;
  exp: number;
  jti?: string;
  [key: string]: any;
}

export interface Sep10AuthServiceOptions {
  serverSecret?: string;
  serverKeypair?: Keypair;
  homeDomain?: string;
  webAuthDomain?: string;
  networkPassphrase?: string;
  jwtSecret?: string;
  challengeExpiresInSeconds?: number;
  jwtExpiresInSeconds?: number;
  redisClient?: Redis;
}

export class Sep10AuthService {
  private serverKeypair: Keypair;
  private homeDomain: string;
  private webAuthDomain: string;
  private networkPassphrase: string;
  private jwtSecret: string;
  private challengeExpiresInSeconds: number;
  private jwtExpiresInSeconds: number;
  private redis?: Redis;
  private memoryNonceStore: Map<string, number>;

  constructor(options?: Sep10AuthServiceOptions) {
    const secret = options?.serverSecret || process.env.STELLAR_SERVER_SECRET;
    if (options?.serverKeypair) {
      this.serverKeypair = options.serverKeypair;
    } else if (secret) {
      this.serverKeypair = Keypair.fromSecret(secret);
    } else {
      this.serverKeypair = Keypair.random();
    }

    this.homeDomain = options?.homeDomain || process.env.STELLAR_HOME_DOMAIN || 'lumina.network';
    this.webAuthDomain = options?.webAuthDomain || process.env.STELLAR_WEB_AUTH_DOMAIN || this.homeDomain;
    this.networkPassphrase = options?.networkPassphrase || (process.env.STELLAR_NETWORK === 'PUBLIC' ? Networks.PUBLIC : Networks.TESTNET);
    this.jwtSecret = options?.jwtSecret || process.env.JWT_SECRET || 'sep10-default-jwt-secret';
    this.challengeExpiresInSeconds = options?.challengeExpiresInSeconds || 300; // 5 minutes
    this.jwtExpiresInSeconds = options?.jwtExpiresInSeconds || 86400; // 24 hours
    this.memoryNonceStore = new Map();

    if (options?.redisClient) {
      this.redis = options.redisClient;
    }
  }

  public getServerPublicKey(): string {
    return this.serverKeypair.publicKey();
  }

  public getNetworkPassphrase(): string {
    return this.networkPassphrase;
  }

  public getHomeDomain(): string {
    return this.homeDomain;
  }

  /**
   * Generates a SEP-10 challenge transaction with random nonce and 5-minute expiry
   */
  public async generateChallenge(clientAccountID: string): Promise<Sep10ChallengeResponse> {
    if (!StrKey.isValidEd25519PublicKey(clientAccountID)) {
      throw new Error(`Invalid client Stellar public key: ${clientAccountID}`);
    }

    const nonce = crypto.randomBytes(32).toString('hex');
    await this.storeNonce(nonce, clientAccountID, this.challengeExpiresInSeconds);

    const challengeXdr = WebAuth.buildChallengeTx(
      this.serverKeypair,
      clientAccountID,
      this.homeDomain,
      this.challengeExpiresInSeconds,
      this.networkPassphrase,
      this.webAuthDomain
    );

    return {
      transaction: challengeXdr,
      networkPassphrase: this.networkPassphrase,
    };
  }

  /**
   * Verifies signed challenge transaction from client and issues JWT token
   */
  public async verifyChallenge(signedChallengeXdr: string): Promise<{ token: string; publicKey: string }> {
    const clientSigners = this.extractClientAccountFromTx(signedChallengeXdr);
    
    let signers: string[];
    try {
      signers = WebAuth.verifyChallengeTxSigners(
        signedChallengeXdr,
        this.serverKeypair.publicKey(),
        this.networkPassphrase,
        clientSigners,
        [this.homeDomain],
        this.webAuthDomain
      );
    } catch (error: any) {
      throw new Error(`SEP-10 challenge verification failed: ${error.message}`);
    }

    if (!signers || signers.length === 0) {
      throw new Error('No valid client signature found on challenge transaction');
    }

    const clientPublicKey = signers[0];

    // Replay protection check
    const isReplay = await this.checkAndInvalidateTx(signedChallengeXdr, clientPublicKey);
    if (isReplay) {
      throw new Error('Challenge transaction has already been used (replay detected)');
    }

    // Issue SEP-10 JWT token
    const token = this.issueToken(clientPublicKey);
    return { token, publicKey: clientPublicKey };
  }

  /**
   * Issues SEP-10 compliant JWT token for authenticated public key
   */
  public issueToken(clientPublicKey: string): string {
    const now = Math.floor(Date.now() / 1000);
    const payload: Sep10TokenPayload = {
      iss: `https://${this.homeDomain}/auth`,
      sub: clientPublicKey,
      iat: now,
      exp: now + this.jwtExpiresInSeconds,
      jti: crypto.randomUUID(),
    };

    return jwt.sign(payload, this.jwtSecret);
  }

  /**
   * Verifies SEP-10 JWT token
   */
  public verifyToken(token: string): Sep10TokenPayload {
    return jwt.verify(token, this.jwtSecret) as Sep10TokenPayload;
  }

  private extractClientAccountFromTx(txXdr: string): string[] {
    const tx = TransactionBuilder.fromXDR(txXdr, this.networkPassphrase);
    const signers: string[] = [];
    for (const op of tx.operations) {
      if (op.type === 'manageData' && op.name === `${this.homeDomain} auth` && op.source) {
        signers.push(op.source);
      }
    }
    return signers.length > 0 ? signers : [this.serverKeypair.publicKey()];
  }

  private async storeNonce(nonce: string, clientAccount: string, ttlSeconds: number): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.set(`sep10:nonce:${nonce}`, clientAccount, 'EX', ttlSeconds);
        return;
      } catch {
        // Fall back to memory
      }
    }
    this.memoryNonceStore.set(nonce, Date.now() + ttlSeconds * 1000);
  }

  private async checkAndInvalidateTx(txXdr: string, clientAccount: string): Promise<boolean> {
    const txHash = crypto.createHash('sha256').update(txXdr).digest('hex');
    const key = `sep10:used:${txHash}`;

    if (this.redis) {
      try {
        const exists = await this.redis.get(key);
        if (exists) return true;
        await this.redis.set(key, clientAccount, 'EX', this.challengeExpiresInSeconds);
        return false;
      } catch {
        // Fall back to memory
      }
    }

    const expiry = this.memoryNonceStore.get(key);
    if (expiry && expiry > Date.now()) {
      return true;
    }
    this.memoryNonceStore.set(key, Date.now() + this.challengeExpiresInSeconds * 1000);
    return false;
  }
}

export default Sep10AuthService;
