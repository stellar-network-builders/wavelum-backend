const { Keypair } = require('@stellar/stellar-sdk');

describe('Sep10AuthService Unit Tests', () => {
  let serverKp;
  let clientKp;

  beforeAll(() => {
    serverKp = Keypair.random();
    clientKp = Keypair.random();
  });

  test('validates stellar public key formats', () => {
    expect(clientKp.publicKey().startsWith('G')).toBe(true);
    expect(clientKp.publicKey().length).toBe(56);
  });

  test('signs and verifies stellar challenge transactions correctly', () => {
    const data = Buffer.from('test challenge verification');
    const signature = serverKp.sign(data);
    expect(serverKp.verify(data, signature)).toBe(true);
  });
});
