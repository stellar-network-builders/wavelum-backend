const request = require('supertest');
const AuditLog = require('../models/AuditLog');
const AuditService = require('../services/AuditService');
const app = require('../index');

describe('Audit Log System', () => {
    let auditLog;
    let auditService;

    beforeAll(async () => {
        auditLog = new AuditLog();
        auditService = new AuditService();
    });

    afterAll(async () => {
        if (auditLog) {
            auditLog.close();
        }
    });

    describe('Audit Log Creation', () => {
        test('should create audit log entry successfully', async () => {
            const result = await auditService.logAdminAction(
                'TEST_ACTION',
                'test-user-123',
                'target-456',
                { old: 'value' },
                { new: 'value' },
                { test: true }
            );

            expect(result).toBeDefined();
            expect(result.id).toBeDefined();
            expect(result.hash).toBeDefined();
            expect(result.previousHash).toBeDefined();
        });

        test('should create chained audit logs', async () => {
            const result1 = await auditService.logAdminAction(
                'CHAIN_TEST_1',
                'test-user-123'
            );

            const result2 = await auditService.logAdminAction(
                'CHAIN_TEST_2',
                'test-user-123'
            );

            expect(result2.previousHash).toBe(result1.hash);
            expect(result2.hash).not.toBe(result1.hash);
        });
    });

    describe('Chain Integrity Verification', () => {
        test('should verify chain integrity', async () => {
            await auditService.logAdminAction('INTEGRITY_TEST_1', 'user1');
            await auditService.logAdminAction('INTEGRITY_TEST_2', 'user2');
            await auditService.logAdminAction('INTEGRITY_TEST_3', 'user3');

            const verification = await auditService.verifyAuditTrail();
            
            expect(verification.valid).toBe(true);
            expect(verification.chainIntegrity.valid).toBe(true);
        });
    });

    describe('API Endpoints', () => {
        test('GET / should return API information', async () => {
            const response = await request(app)
                .get('/')
                .expect(200);

            expect(response.body.project).toBe('Vesting Vault');
            expect(response.body.features).toContain('Tamper-proof audit logging');
        });

        test('POST /api/vesting/cliff-date should create audit log', async () => {
            const response = await request(app)
                .post('/api/vesting/cliff-date')
                .send({
                    beneficiaryId: 'beneficiary-123',
                    previousCliffDate: '2024-01-01',
                    newCliffDate: '2024-06-01',
                    adminId: 'admin-456'
                })
                .expect(200);

            expect(response.body.success).toBe(true);
        });

        test('POST /api/admin/action should create audit log', async () => {
            const response = await request(app)
                .post('/api/admin/action')
                .send({
                    action: 'modify_vesting',
                    targetId: 'target-789',
                    changes: { amount: 1000 },
                    adminId: 'admin-456'
                })
                .expect(200);

            expect(response.body.success).toBe(true);
        });

        test('GET /api/audit/history should return audit logs', async () => {
            await auditService.logAdminAction('HISTORY_TEST', 'test-user');

            const response = await request(app)
                .get('/api/audit/history')
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(Array.isArray(response.body.data)).toBe(true);
        });

        test('GET /api/audit/chain-integrity should verify chain', async () => {
            const response = await request(app)
                .get('/api/audit/chain-integrity')
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.valid).toBeDefined();
        });

        test('GET /api/audit/stellar/account should return account info', async () => {
            const response = await request(app)
                .get('/api/audit/stellar/account')
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.data).toBeDefined();
        });
    });

    describe('Daily Hash Calculation', () => {
        test('should calculate daily root hash', async () => {
            const today = new Date().toISOString().split('T')[0];
            
            await auditService.logAdminAction('DAILY_TEST_1', 'user1');
            await auditService.logAdminAction('DAILY_TEST_2', 'user2');

            const rootHashResult = await auditLog.calculateDailyRootHash(today);
            
            expect(rootHashResult).toBeDefined();
            expect(rootHashResult.rootHash).toBeDefined();
            expect(rootHashResult.logCount).toBeGreaterThan(0);
        });

        test('should anchor daily logs', async () => {
            const today = new Date().toISOString().split('T')[0];
            
            await auditService.logAdminAction('ANCHOR_TEST', 'user1');

            const result = await auditService.anchorDailyLogs(today);
            
            expect(result).toBeDefined();
            expect(result.success).toBeDefined();
        });
    });

    describe('Manual Audit Creation', () => {
        test('POST /api/audit/manual should create manual audit', async () => {
            const response = await request(app)
                .post('/api/audit/manual')
                .send({
                    actorId: 'manual-user',
                    targetId: 'manual-target',
                    oldData: { status: 'old' },
                    newData: { status: 'new' },
                    metadata: { source: 'manual' }
                })
                .expect(200);

            expect(response.body.success).toBe(true);
        });
    });
});

module.exports = {};
