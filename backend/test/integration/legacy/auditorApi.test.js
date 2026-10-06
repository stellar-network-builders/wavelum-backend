const request = require("supertest");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

// Mock Redis client early
jest.mock("redis", () => ({
  createClient: jest.fn(() => ({
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue(),
    isOpen: true,
  })),
}));

jest.mock("../src/services/indexingService", () => ({
  initialize: jest.fn().mockResolvedValue(),
  initContract: jest.fn(),
  indexHistoricalBlocks: jest.fn(),
  listenToEvents: jest.fn(),
}));

// Mock stellar-sdk to avoid constructor errors in test env
jest.mock("stellar-sdk", () => ({
  Server: jest.fn().mockImplementation(() => ({ root: jest.fn() })),
  Horizon: { Server: jest.fn().mockImplementation(() => ({ root: jest.fn() })) },
  Networks: { TESTNET: "Test SDF Network ; September 2015" },
  Keypair: { random: jest.fn() },
  TransactionBuilder: jest.fn(),
  Operation: {},
  Asset: { native: jest.fn() },
  rpc: { Server: jest.fn().mockImplementation(() => ({ getContractWasmByContractId: jest.fn() })) },
  xdr: {},
  Address: jest.fn(),
}));

// Mock HSM gateway service (depends on stellar-sdk Server)
jest.mock("../src/services/hsmGatewayService", () => ({
  signTransaction: jest.fn(),
  getPublicKey: jest.fn(),
}));

// Mock firebase service to avoid credential issues
jest.mock("../src/services/firebaseService", () => ({
  sendPushNotification: jest.fn(),
  sendMulticast: jest.fn(),
}));

const { sequelize } = require("../src/database/connection");
const { app } = require("../src/index");
const {
  Organization,
  Vault,
  SubSchedule,
  ClaimsHistory,
  VaultLegalDocument,
  AuditorToken,
} = require("../src/models");

jest.setTimeout(60000);

// Helper to generate an admin JWT for the test admin address
function generateAdminToken(address) {
  return jwt.sign(
    { address, role: "admin", type: "access" },
    process.env.JWT_SECRET || "test-secret",
    { expiresIn: "1h", issuer: "vesting-vault", audience: "vesting-vault-api" },
  );
}

describe("Read-Only Auditor API", () => {
  const adminAddress = "0xADMIN0000000000000000000000000000000001";
  const outsiderAddress = "0xOUTSIDER000000000000000000000000000001";
  let org;
  let vault;
  let adminToken;

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
    process.env.ADMIN_ADDRESSES = adminAddress;
    await sequelize.sync({ force: true });
  });

  beforeEach(async () => {
    // Clean up in correct order to respect FK constraints
    await AuditorToken.destroy({ where: {}, force: true });
    await SubSchedule.destroy({ where: {}, force: true });
    await VaultLegalDocument.destroy({ where: {}, force: true });
    await Vault.destroy({ where: {}, force: true });
    await Organization.destroy({ where: {}, force: true });

    // Create org and vault
    org = await Organization.create({
      name: "Audit Test Org",
      admin_address: adminAddress,
    });

    vault = await Vault.create({
      address: "0xVAULT000000000000000000000000000000001",
      name: "Audit Vault",
      token_address: "0xTOKEN000000000000000000000000000000001",
      owner_address: adminAddress,
      total_amount: "10000",
      org_id: org.id,
    });

    await SubSchedule.create({
      vault_id: vault.id,
      top_up_amount: "5000",
      cliff_duration: 86400,
      vesting_start_date: new Date(),
      vesting_duration: 86400 * 365,
      start_timestamp: new Date(),
      end_timestamp: new Date(Date.now() + 86400 * 365 * 1000),
      transaction_hash: "0xTXHASH00000000000000000000000000000001",
    });

    adminToken = generateAdminToken(adminAddress);
  });

  afterAll(async () => {
    await sequelize.close();
  });

  // ── Token Issuance ──

  describe("POST /api/auditor/tokens", () => {
    test("should issue an auditor token", async () => {
      const res = await request(app)
        .post("/api/auditor/tokens")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          auditor_name: "Deloitte Digital",
          auditor_firm: "Deloitte",
          org_id: org.id,
          expires_in_days: 30,
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.token).toBeDefined();
      expect(res.body.data.scopes).toEqual([
        "vesting_schedules",
        "withdrawal_history",
        "contract_hashes",
      ]);
      expect(res.body.data.auditor_name).toBe("Deloitte Digital");
    });

    test("should reject issuance without required fields", async () => {
      const res = await request(app)
        .post("/api/auditor/tokens")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ auditor_firm: "KPMG" })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    test("should reject issuance without authentication", async () => {
      const res = await request(app)
        .post("/api/auditor/tokens")
        .send({
          auditor_name: "EY",
          org_id: org.id,
        })
        .expect(401);

      expect(res.body.success).toBe(false);
    });

    test("should allow custom scopes", async () => {
      const res = await request(app)
        .post("/api/auditor/tokens")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          auditor_name: "PwC",
          org_id: org.id,
          scopes: ["vesting_schedules"],
          expires_in_days: 7,
        })
        .expect(201);

      expect(res.body.data.scopes).toEqual(["vesting_schedules"]);
    });

    test("should reject invalid scopes", async () => {
      const res = await request(app)
        .post("/api/auditor/tokens")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          auditor_name: "Auditor",
          org_id: org.id,
          scopes: ["invalid_scope"],
        })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain("Invalid scopes");
    });
  });

  // ── Token Listing ──

  describe("GET /api/auditor/tokens/:orgId", () => {
    test("should list auditor tokens for the org", async () => {
      // Issue a token first
      await request(app)
        .post("/api/auditor/tokens")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ auditor_name: "Auditor A", org_id: org.id });

      const res = await request(app)
        .get(`/api/auditor/tokens/${org.id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      // token_hash should NOT be exposed
      expect(res.body.data[0].token_hash).toBeUndefined();
    });
  });

  // ── Token Revocation ──

  describe("DELETE /api/auditor/tokens/:tokenId", () => {
    test("should revoke an auditor token", async () => {
      const issueRes = await request(app)
        .post("/api/auditor/tokens")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ auditor_name: "Revoke Me", org_id: org.id });

      // Get the token record
      const tokens = await AuditorToken.findAll({ where: { org_id: org.id } });
      const tokenId = tokens[0].id;

      const res = await request(app)
        .delete(`/api/auditor/tokens/${tokenId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.revoked).toBe(true);

      // Using the revoked token should fail
      const reportRes = await request(app)
        .get("/api/auditor/report/summary")
        .set("Authorization", `Bearer ${issueRes.body.data.token}`)
        .expect(401);

      expect(reportRes.body.success).toBe(false);
    });
  });

  // ── Read-Only Report Endpoints ──

  describe("Auditor Report Endpoints", () => {
    let auditorJwt;

    beforeEach(async () => {
      const issueRes = await request(app)
        .post("/api/auditor/tokens")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          auditor_name: "Report Auditor",
          org_id: org.id,
          expires_in_days: 7,
        });

      auditorJwt = issueRes.body.data.token;
    });

    test("GET /api/auditor/report/summary should return audit summary", async () => {
      const res = await request(app)
        .get("/api/auditor/report/summary")
        .set("Authorization", `Bearer ${auditorJwt}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.organization.name).toBe("Audit Test Org");
      expect(res.body.data.totals.vaults).toBeGreaterThanOrEqual(1);
    });

    test("GET /api/auditor/report/vesting-schedules should return schedules", async () => {
      const res = await request(app)
        .get("/api/auditor/report/vesting-schedules")
        .set("Authorization", `Bearer ${auditorJwt}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.vaults.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data.pagination).toBeDefined();
    });

    test("GET /api/auditor/report/withdrawal-history should return claims", async () => {
      const res = await request(app)
        .get("/api/auditor/report/withdrawal-history")
        .set("Authorization", `Bearer ${auditorJwt}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.claims).toBeDefined();
      expect(res.body.data.pagination).toBeDefined();
    });

    test("GET /api/auditor/report/contract-hashes should return document hashes", async () => {
      const res = await request(app)
        .get("/api/auditor/report/contract-hashes")
        .set("Authorization", `Bearer ${auditorJwt}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.documents).toBeDefined();
      expect(res.body.data.pagination).toBeDefined();
    });

    test("should reject requests without auditor token", async () => {
      const res = await request(app)
        .get("/api/auditor/report/summary")
        .expect(401);

      expect(res.body.success).toBe(false);
    });

    test("should reject expired auditor tokens", async () => {
      // Manually create an expired token
      const expiredPayload = {
        type: "auditor",
        org_id: org.id,
        scopes: ["vesting_schedules", "withdrawal_history", "contract_hashes"],
        auditor_name: "Expired Auditor",
      };

      const expiredToken = jwt.sign(expiredPayload, process.env.JWT_SECRET, {
        expiresIn: "0s",
        issuer: "vesting-vault",
        audience: "vesting-vault-auditor",
        jwtid: crypto.randomUUID(),
      });

      const res = await request(app)
        .get("/api/auditor/report/summary")
        .set("Authorization", `Bearer ${expiredToken}`)
        .expect(401);

      expect(res.body.success).toBe(false);
    });

    test("should enforce scope restrictions", async () => {
      // Issue a token with only vesting_schedules scope
      const limitedRes = await request(app)
        .post("/api/auditor/tokens")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          auditor_name: "Limited Auditor",
          org_id: org.id,
          scopes: ["vesting_schedules"],
        });

      const limitedToken = limitedRes.body.data.token;

      // Should work for vesting schedules
      await request(app)
        .get("/api/auditor/report/vesting-schedules")
        .set("Authorization", `Bearer ${limitedToken}`)
        .expect(200);

      // Should fail for withdrawal history
      const failRes = await request(app)
        .get("/api/auditor/report/withdrawal-history")
        .set("Authorization", `Bearer ${limitedToken}`)
        .expect(403);

      expect(failRes.body.error).toContain("Required scope");
    });

    test("auditor token should only access its scoped org data", async () => {
      // The auditor token is scoped to org.id — it should not return data from other orgs
      const res = await request(app)
        .get("/api/auditor/report/vesting-schedules")
        .set("Authorization", `Bearer ${auditorJwt}`)
        .expect(200);

      // All returned vaults should belong to the same org
      for (const v of res.body.data.vaults) {
        const dbVault = await Vault.findByPk(v.id);
        expect(dbVault.org_id).toBe(org.id);
      }
    });

    test("should support pagination", async () => {
      const res = await request(app)
        .get("/api/auditor/report/vesting-schedules?page=1&limit=1")
        .set("Authorization", `Bearer ${auditorJwt}`)
        .expect(200);

      expect(res.body.data.pagination.limit).toBe(1);
      expect(res.body.data.pagination.page).toBe(1);
    });
  });
});
