const reportService = require('./reportService');
const { ClaimsHistory } = require('../models');

jest.mock('../models', () => ({
  ClaimsHistory: {
    findAll: jest.fn()
  }
}));

describe('ReportService', () => {
  it('should generate a PDF buffer when claims exist', async () => {
    ClaimsHistory.findAll.mockResolvedValue([
      {
        user_address: '0x1234567890123456789012345678901234567890',
        token_address: '0xabcdef1234567890abcdef1234567890abcdef12',
        amount_claimed: '100.50',
        claim_timestamp: new Date()
      }
    ]);

    const pdfBuffer = await reportService.generateMonthlyClaimsPDF();
    expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
    // PDF header signature %PDF-1.3 is 8 bytes, so it should be larger
    expect(pdfBuffer.length).toBeGreaterThan(100); 
  });

  it('should generate a PDF buffer when no claims exist', async () => {
    ClaimsHistory.findAll.mockResolvedValue([]);

    const pdfBuffer = await reportService.generateMonthlyClaimsPDF();
    expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
    expect(pdfBuffer.length).toBeGreaterThan(100);
  });
});
