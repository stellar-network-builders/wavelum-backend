const { encryptEmail, decryptEmail } = require('../src/util/cryptoUtils');
const { sequelize } = require('../src/database/connection');
const Beneficiary = require('../src/models/beneficiary');
const Vault = require('../src/models/vault');

describe('Email Encryption Utility', () => {
  it('encrypts and decrypts emails consistently', () => {
    const rawEmail = 'test@example.com';
    const encrypted = encryptEmail(rawEmail);
    expect(encrypted).not.toBe(rawEmail);
    expect(encrypted.length).toBeGreaterThan(rawEmail.length);
    
    const decrypted = decryptEmail(encrypted);
    expect(decrypted).toBe(rawEmail);
    
    // Deterministic check
    const encrypted2 = encryptEmail(rawEmail);
    expect(encrypted).toBe(encrypted2);
  });

  it('handles null values', () => {
    expect(encryptEmail(null)).toBeNull();
    expect(decryptEmail(null)).toBeNull();
  });
});
