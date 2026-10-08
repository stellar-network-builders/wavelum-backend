// backend/src/middleware/prisma_pii.js
const { encrypt, decrypt } = require('../util/encryption');

function handlePII(model, data) {
  if (data.full_name) data.full_name = encrypt(data.full_name);
  if (data.tax_id) data.tax_id = encrypt(data.tax_id);
  return data;
}

function decryptPII(record) {
  if (record.full_name) record.full_name = decrypt(record.full_name);
  if (record.tax_id) record.tax_id = decrypt(record.tax_id);
  return record;
}

module.exports = { handlePII, decryptPII };
