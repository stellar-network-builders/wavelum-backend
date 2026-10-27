// backend/src/controllers/kyc_webhook_controller.js
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const service = require('../services/kyc_service');

const PROVIDER_SECRET = process.env.KYC_WEBHOOK_SECRET;

function verifySignature(req) {
  const signature = req.headers['x-signature'];
  const payload = JSON.stringify(req.body);
  const expected = crypto.createHmac('sha256', PROVIDER_SECRET).update(payload).digest('hex');
  return signature === expected;
}

/**
 * @swagger
 * /api/v1/webhook/kyc:
 *   post:
 *     summary: Receive HMAC-verified KYC provider status webhook
 *     tags: [identity]
 *     parameters:
 *       - in: header
 *         name: x-signature
 *         required: true
 *         schema:
 *           type: string
 *         description: HMAC-SHA256 signature of the JSON request body
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/KycWebhookDto'
 *     responses:
 *       200:
 *         description: Webhook processed successfully
 *       401:
 *         description: Invalid HMAC signature
 */
router.post('/webhook/kyc', async (req, res) => {
  try {
    if (!verifySignature(req)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { applicantId, reviewStatus } = req.body;
    if (reviewStatus === 'completed') {
      await service.updateCustomerStatus(applicantId, 'ACCEPTED');
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
