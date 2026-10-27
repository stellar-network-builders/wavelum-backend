// backend/src/controllers/kyc_risk_controller.js
const express = require('express');
const router = express.Router();
const service = require('../services/kyc_risk_service');

/**
 * @swagger
 * /api/v1/kyc/evaluate:
 *   post:
 *     summary: Evaluate KYC risk level for a vesting schedule beneficiary
 *     tags: [identity]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/KycEvaluateDto'
 *     responses:
 *       200:
 *         description: KYC risk evaluation result
 *       500:
 *         description: Evaluation service error
 */
router.post('/kyc/evaluate', async (req, res) => {
  try {
    const { profileId, vestingValueUsd, basicChecksPassed } = req.body;
    const result = await service.evaluateKyc(profileId, vestingValueUsd, basicChecksPassed);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
