// backend/src/controllers/identity_controller.js
const express = require('express');
const router = express.Router();
const service = require('../services/identity_service');

/**
 * @swagger
 * /api/v1/identity/link-key:
 *   post:
 *     summary: Link a Stellar public key to an identity profile
 *     tags: [identity]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/IdentityLinkKeyDto'
 *     responses:
 *       200:
 *         description: Key linked successfully
 *       400:
 *         description: Invalid identity profile or key parameters
 */
router.post('/identity/link-key', async (req, res) => {
  try {
    const { profileId, publicKey, vestingSchedule } = req.body;
    const result = await service.linkKey(profileId, publicKey, vestingSchedule);
    res.json({ success: true, result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/v1/identity/unlink-key:
 *   delete:
 *     summary: Unlink a Stellar public key from an identity profile
 *     tags: [identity]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/IdentityLinkKeyDto'
 *     responses:
 *       200:
 *         description: Key unlinked successfully
 *       400:
 *         description: Invalid request parameters
 */
router.delete('/identity/unlink-key', async (req, res) => {
  try {
    const { profileId, publicKey } = req.body;
    await service.unlinkKey(profileId, publicKey);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/v1/identity/{profileId}/keys:
 *   get:
 *     summary: List all public keys linked to an identity profile
 *     tags: [identity]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: profileId
 *         required: true
 *         schema:
 *           type: string
 *         description: Identity profile identifier
 *     responses:
 *       200:
 *         description: Array of linked public keys
 */
router.get('/identity/:profileId/keys', async (req, res) => {
  const keys = await service.getKeys(req.params.profileId);
  res.json(keys);
});

/**
 * @swagger
 * /api/v1/identity/key/{publicKey}/profile:
 *   get:
 *     summary: Resolve identity profile by Stellar public key
 *     tags: [identity]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *         description: Stellar public key
 *     responses:
 *       200:
 *         description: Resolved identity profile
 *       404:
 *         description: Profile not found
 */
router.get('/identity/key/:publicKey/profile', async (req, res) => {
  const profile = await service.getProfile(req.params.publicKey);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });
  res.json(profile);
});

module.exports = router;
