// Run only this regression: npx jest test/sep10Auth.integration.test.js --runInBand
// The real Stellar SDK signs and checks the challenge XDR; the store is local
// to this test, with atomic consume semantics equivalent to Redis GETDEL.
require("ts-node/register/transpile-only");

const { Keypair, Networks, TransactionBuilder } = require("stellar-sdk");
const { Sep10AuthService } = require("../src/services/Sep10AuthService.ts");

describe("SEP-10 wallet challenge authentication", () => {
  test("accepts a signed client challenge exactly once", async () => {
    const server = Keypair.random();
    const wallet = Keypair.random();
    const records = new Map();
    const challengeStore = {
      isReady: () => true,
      async set(key, value, ttl) {
        expect(ttl).toBe(300);
        records.set(key, value);
        return true;
      },
      async consume(key) {
        const value = records.get(key) || null;
        records.delete(key);
        return value;
      },
    };
    const service = new Sep10AuthService({
      serverSigningSeed: server.secret(),
      homeDomain: "example.org",
      webAuthDomain: "auth.example.org",
      networkPassphrase: Networks.TESTNET,
      challengeStore,
    });

    const challenge = await service.createChallenge(wallet.publicKey());
    expect(challenge.expiresIn).toBe(300);
    expect(challenge.networkPassphrase).toBe(Networks.TESTNET);
    const signed = TransactionBuilder.fromXDR(
      challenge.transaction,
      Networks.TESTNET,
    );
    signed.sign(wallet);
    const signedXdr = signed.toXDR();

    const verified = await service.verifyChallenge(signedXdr);
    expect(verified.account).toBe(wallet.publicKey());
    await expect(service.verifyChallenge(signedXdr)).rejects.toMatchObject({
      code: "challenge_replayed_or_expired",
      status: 401,
    });
    expect(records.size).toBe(0);
  });
});
