/**
 * Tests for Rule144ComplianceMiddleware
 */

const { 
  rule144ComplianceMiddleware, 
  recordClaimComplianceMiddleware 
} = require('./rule144Compliance.middleware');
const rule144ComplianceService = require('../services/rule144ComplianceService');

// Mock the compliance service
jest.mock('../services/rule144ComplianceService');

describe('Rule144ComplianceMiddleware', () => {
  let mockReq, mockRes, mockNext;

  beforeEach(() => {
    mockReq = {
      path: '/api/claims',
      body: {
        user_address: '0xuseruseruseruseruseruseruseruseruser',
        vault_id: 'vault-123'
      },
      ip: '127.0.0.1',
      get: jest.fn()
    };
    
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      statusCode: 200
    };
    
    mockNext = jest.fn();
    
    jest.clearAllMocks();
  });

  describe('rule144ComplianceMiddleware', () => {
    test('should call next for non-claim endpoints', async () => {
      mockReq.path = '/api/vaults';
      
      await rule144ComplianceMiddleware(mockReq, mockRes, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
      expect(rule144ComplianceService.checkClaimCompliance).not.toHaveBeenCalled();
    });

    test('should block claim when not compliant', async () => {
      rule144ComplianceService.checkClaimCompliance.mockResolvedValue({
        isCompliant: false,
        complianceStatus: 'RESTRICTED',
        holdingPeriodEndDate: new Date('2024-07-01'),
        daysUntilCompliance: 30,
        isRestrictedSecurity: true,
        exemptionType: 'NONE',
        jurisdiction: 'US',
        message: 'Claim is restricted. Holding period ends in 30 days'
      });

      await rule144ComplianceMiddleware(mockReq, mockRes, mockNext);

      expect(rule144ComplianceService.checkClaimCompliance).toHaveBeenCalledWith(
        'vault-123',
        '0xuseruseruseruseruseruseruseruseruser'
      );
      
      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: 'CLAIM_RESTRICTED_BY_RULE144',
        message: 'Claim is restricted. Holding period ends in 30 days',
        data: {
          complianceStatus: 'RESTRICTED',
          holdingPeriodEndDate: expect.any(Date),
          daysUntilCompliance: 30,
          isRestrictedSecurity: true,
          exemptionType: 'NONE',
          jurisdiction: 'US'
        }
      });
      
      expect(mockNext).not.toHaveBeenCalled();
    });

    test('should allow claim when compliant', async () => {
      rule144ComplianceService.checkClaimCompliance.mockResolvedValue({
        isCompliant: true,
        complianceStatus: 'COMPLIANT',
        holdingPeriodEndDate: new Date('2024-01-01'),
        daysUntilCompliance: 0,
        isRestrictedSecurity: true,
        exemptionType: 'NONE',
        jurisdiction: 'US',
        message: 'Claim is compliant with Rule 144'
      });

      await rule144ComplianceMiddleware(mockReq, mockRes, mockNext);

      expect(rule144ComplianceService.checkClaimCompliance).toHaveBeenCalledWith(
        'vault-123',
        '0xuseruseruseruseruseruseruseruseruser'
      );
      
      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.rule144Compliance).toBeDefined();
      expect(mockReq.rule144Compliance.isCompliant).toBe(true);
    });

    test('should return 400 for missing required fields', async () => {
      mockReq.body = { user_address: '0xuseruseruseruseruseruseruseruseruser' }; // missing vault_id

      await rule144ComplianceMiddleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: 'user_address and vault_id are required for compliance check'
      });
      
      expect(mockNext).not.toHaveBeenCalled();
    });

    test('should handle compliance check errors', async () => {
      rule144ComplianceService.checkClaimCompliance.mockRejectedValue(
        new Error('Database error')
      );

      await rule144ComplianceMiddleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: 'COMPLIANCE_CHECK_FAILED',
        message: 'Unable to verify compliance. Please try again later or contact support.'
      });
      
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('recordClaimComplianceMiddleware', () => {
    test('should record claim for successful claims', async () => {
      mockReq.body = {
        user_address: '0xuseruseruseruseruseruseruseruseruser',
        vault_id: 'vault-123',
        amount_claimed: '100'
      };
      mockRes.statusCode = 201;

      rule144ComplianceService.recordClaimAttempt.mockResolvedValue({});

      await recordClaimComplianceMiddleware(mockReq, mockRes, mockNext);

      expect(rule144ComplianceService.recordClaimAttempt).toHaveBeenCalledWith(
        'vault-123',
        '0xuseruseruseruseruseruseruseruseruser',
        '100',
        expect.any(Date)
      );
      
      expect(mockNext).toHaveBeenCalled();
    });

    test('should not record for non-claim endpoints', async () => {
      mockReq.path = '/api/vaults';

      await recordClaimComplianceMiddleware(mockReq, mockRes, mockNext);

      expect(rule144ComplianceService.recordClaimAttempt).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
    });

    test('should not record for failed claims', async () => {
      mockRes.statusCode = 400;

      await recordClaimComplianceMiddleware(mockReq, mockRes, mockNext);

      expect(rule144ComplianceService.recordClaimAttempt).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
    });

    test('should handle missing required fields gracefully', async () => {
      mockReq.body = {
        user_address: '0xuseruseruseruseruseruseruseruseruser'
        // missing vault_id and amount_claimed
      };
      mockRes.statusCode = 201;

      await recordClaimComplianceMiddleware(mockReq, mockRes, mockNext);

      expect(rule144ComplianceService.recordClaimAttempt).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
    });

    test('should handle recording errors without blocking response', async () => {
      mockReq.body = {
        user_address: '0xuseruseruseruseruseruseruseruseruser',
        vault_id: 'vault-123',
        amount_claimed: '100'
      };
      mockRes.statusCode = 201;

      rule144ComplianceService.recordClaimAttempt.mockRejectedValue(
        new Error('Recording failed')
      );

      await recordClaimComplianceMiddleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled(); // Should still call next even on error
    });
  });
});
