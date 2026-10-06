// backend/tests/pii_encryption_tests.js
const { encrypt, decrypt } = require('../src/utils/encryption');

describe('PII Encryption', () => {
  it('should encrypt and decrypt correctly', () => {
    const original = 'John Doe';
    const encrypted = encrypt(original);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(original);
  });
});
