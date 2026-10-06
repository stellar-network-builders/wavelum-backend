const request = require('supertest');
const app = require('../index');

describe('RBAC Authentication Tests', () => {
    let superAdminToken, financeManagerToken, hrManagerToken, auditorToken;

    beforeAll(async () => {
        // Generate test tokens for each role
        const superAdminResponse = await request(app)
            .post('/api/auth/token/generate')
            .send({
                id: 'super-admin-1',
                email: 'superadmin@test.com',
                role: 'super_admin'
            });
        
        superAdminToken = superAdminResponse.body.token;

        const financeManagerResponse = await request(app)
            .post('/api/auth/token/generate')
            .send({
                id: 'finance-manager-1',
                email: 'finance@test.com',
                role: 'finance_manager'
            });
        
        financeManagerToken = financeManagerResponse.body.token;

        const hrManagerResponse = await request(app)
            .post('/api/auth/token/generate')
            .send({
                id: 'hr-manager-1',
                email: 'hr@test.com',
                role: 'hr_manager'
            });
        
        hrManagerToken = hrManagerResponse.body.token;

        const auditorResponse = await request(app)
            .post('/api/auth/token/generate')
            .send({
                id: 'auditor-1',
                email: 'auditor@test.com',
                role: 'read_only_auditor'
            });
        
        auditorToken = auditorResponse.body.token;
    });

    describe('Token Generation', () => {
        test('Should generate token for Super Admin', async () => {
            expect(superAdminToken).toBeDefined();
            expect(typeof superAdminToken).toBe('string');
        });

        test('Should generate token for Finance Manager', async () => {
            expect(financeManagerToken).toBeDefined();
            expect(typeof financeManagerToken).toBe('string');
        });

        test('Should generate token for HR Manager', async () => {
            expect(hrManagerToken).toBeDefined();
            expect(typeof hrManagerToken).toBe('string');
        });

        test('Should generate token for Read-Only Auditor', async () => {
            expect(auditorToken).toBeDefined();
            expect(typeof auditorToken).toBe('string');
        });

        test('Should reject invalid role', async () => {
            const response = await request(app)
                .post('/api/auth/token/generate')
                .send({
                    id: 'test-1',
                    email: 'test@test.com',
                    role: 'invalid_role'
                });
            
            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
        });
    });

    describe('Token Verification', () => {
        test('Should verify valid Super Admin token', async () => {
            const response = await request(app)
                .get('/api/auth/token/verify')
                .set('Authorization', `Bearer ${superAdminToken}`);
            
            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.user.role).toBe('super_admin');
        });

        test('Should reject invalid token', async () => {
            const response = await request(app)
                .get('/api/auth/token/verify')
                .set('Authorization', 'Bearer invalid-token');
            
            expect(response.status).toBe(403);
            expect(response.body.success).toBe(false);
        });

        test('Should reject missing token', async () => {
            const response = await request(app)
                .get('/api/auth/token/verify');
            
            expect(response.status).toBe(401);
            expect(response.body.success).toBe(false);
        });
    });

    describe('RBAC Access Control', () => {
        test('Super Admin should access audit endpoints', async () => {
            const response = await request(app)
                .get('/api/audit/history')
                .set('Authorization', `Bearer ${superAdminToken}`);
            
            expect(response.status).toBe(200);
        });

        test('Finance Manager should access audit history', async () => {
            const response = await request(app)
                .get('/api/audit/history')
                .set('Authorization', `Bearer ${financeManagerToken}`);
            
            expect(response.status).toBe(200);
        });

        test('HR Manager should access audit history', async () => {
            const response = await request(app)
                .get('/api/audit/history')
                .set('Authorization', `Bearer ${hrManagerToken}`);
            
            expect(response.status).toBe(200);
        });

        test('Auditor should access audit history', async () => {
            const response = await request(app)
                .get('/api/audit/history')
                .set('Authorization', `Bearer ${auditorToken}`);
            
            expect(response.status).toBe(200);
        });

        test('HR Manager should NOT modify vesting schedules', async () => {
            const response = await request(app)
                .post('/api/vesting/cliff-date')
                .set('Authorization', `Bearer ${hrManagerToken}`)
                .send({
                    beneficiaryId: 'test-beneficiary',
                    previousCliffDate: '2024-01-01',
                    newCliffDate: '2024-06-01'
                });
            
            expect(response.status).toBe(403);
            expect(response.body.success).toBe(false);
        });

        test('Auditor should NOT modify vesting schedules', async () => {
            const response = await request(app)
                .post('/api/vesting/cliff-date')
                .set('Authorization', `Bearer ${auditorToken}`)
                .send({
                    beneficiaryId: 'test-beneficiary',
                    previousCliffDate: '2024-01-01',
                    newCliffDate: '2024-06-01'
                });
            
            expect(response.status).toBe(403);
            expect(response.body.success).toBe(false);
        });

        test('Super Admin should modify vesting schedules', async () => {
            const response = await request(app)
                .post('/api/vesting/cliff-date')
                .set('Authorization', `Bearer ${superAdminToken}`)
                .send({
                    beneficiaryId: 'test-beneficiary',
                    previousCliffDate: '2024-01-01',
                    newCliffDate: '2024-06-01'
                });
            
            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
        });
    });

    describe('Role Permissions Test', () => {
        test('Should return permissions for Super Admin', async () => {
            const response = await request(app)
                .get('/api/auth/permissions/super_admin');
            
            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.permissions).toContain('full_system_control');
        });

        test('Should return permissions for Finance Manager', async () => {
            const response = await request(app)
                .get('/api/auth/permissions/finance_manager');
            
            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.permissions).toContain('initiate_withdrawals');
            expect(response.body.permissions).not.toContain('full_system_control');
        });

        test('Should return permissions for HR Manager', async () => {
            const response = await request(app)
                .get('/api/auth/permissions/hr_manager');
            
            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.permissions).toContain('onboard_users');
            expect(response.body.permissions).not.toContain('initiate_withdrawals');
        });

        test('Should return permissions for Auditor', async () => {
            const response = await request(app)
                .get('/api/auth/permissions/read_only_auditor');
            
            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.permissions).toContain('view_audit_logs');
            expect(response.body.permissions).not.toContain('modify_vesting_schedules');
        });
    });

    describe('Test Access Endpoint', () => {
        test('Super Admin access test', async () => {
            const response = await request(app)
                .get('/api/auth/test-access')
                .set('Authorization', `Bearer ${superAdminToken}`);
            
            expect(response.status).toBe(200);
            expect(response.body.hasFullControl).toBe(true);
        });

        test('Finance Manager access test', async () => {
            const response = await request(app)
                .get('/api/auth/test-access')
                .set('Authorization', `Bearer ${financeManagerToken}`);
            
            expect(response.status).toBe(200);
            expect(response.body.canInitiateWithdrawals).toBe(true);
            expect(response.body.hasFullControl).toBe(false);
        });

        test('HR Manager access test', async () => {
            const response = await request(app)
                .get('/api/auth/test-access')
                .set('Authorization', `Bearer ${hrManagerToken}`);
            
            expect(response.status).toBe(200);
            expect(response.body.canOnboardUsers).toBe(true);
            expect(response.body.canInitiateWithdrawals).toBe(false);
        });

        test('Auditor access test', async () => {
            const response = await request(app)
                .get('/api/auth/test-access')
                .set('Authorization', `Bearer ${auditorToken}`);
            
            expect(response.status).toBe(200);
            expect(response.body.canViewAuditLogs).toBe(true);
            expect(response.body.canModifyVesting).toBe(false);
        });
    });
});
