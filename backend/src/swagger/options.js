const path = require('path');
const swaggerJsdoc = require('swagger-jsdoc');

const backendRoot = path.resolve(__dirname, '../..');

function buildNestDecoratorOpenApiSpec() {
  const schemas = {
    VaultDto: {
      type: 'object',
      required: ['id', 'address', 'name', 'tokenAddress', 'ownerAddress', 'totalAmount', 'createdAt'],
      properties: {
        id: {
          type: 'string',
          format: 'uuid',
          description: 'Unique identifier of the vesting vault',
          examples: ['550e8400-e29b-41d4-a716-446655440000'],
        },
        address: {
          type: 'string',
          description: 'Smart contract address of the vault on Stellar Soroban or EVM',
          examples: ['CA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA'],
        },
        name: {
          type: 'string',
          description: 'Human-readable vault name',
          examples: ['Core Contributors Vesting Vault'],
        },
        tokenAddress: {
          type: 'string',
          description: 'Token contract address being vested',
          examples: ['CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'],
        },
        ownerAddress: {
          type: 'string',
          description: 'Vault administrator address',
          examples: ['GBYWLISGOUWQ43VQEGXX6KRGDZ3CKAFFK3JXVLXKDO5TIFJUJ3OHJYOZ'],
        },
        totalAmount: {
          type: 'string',
          description: 'Total token allocation in base units',
          examples: ['1000000000000'],
        },
        liquidityStatus: {
          type: ['string', 'null'],
          enum: ['healthy', 'warning', 'critical'],
          description: 'Liquidity status of the vault',
          examples: ['healthy'],
        },
        createdAt: {
          type: 'string',
          format: 'date-time',
          description: 'Creation timestamp in ISO 8601 format',
          examples: ['2026-01-01T00:00:00.000Z'],
        },
      },
    },
    CreateVaultDto: {
      type: 'object',
      required: ['address', 'name', 'tokenAddress', 'ownerAddress', 'totalAmount'],
      properties: {
        address: {
          type: 'string',
          description: 'Smart contract address of the vault',
          examples: ['CA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA'],
        },
        name: {
          type: 'string',
          description: 'Human-readable name for the vault',
          examples: ['Core Contributors Vesting Vault'],
        },
        tokenAddress: {
          type: 'string',
          description: 'Token contract address being vested',
          examples: ['CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'],
        },
        ownerAddress: {
          type: 'string',
          description: 'Vault administrator address',
          examples: ['GBYWLISGOUWQ43VQEGXX6KRGDZ3CKAFFK3JXVLXKDO5TIFJUJ3OHJYOZ'],
        },
        totalAmount: {
          type: 'string',
          description: 'Total token allocation in base units',
          examples: ['1000000000000'],
        },
      },
    },
    ClaimRequestDto: {
      type: 'object',
      required: ['beneficiaryAddress', 'vaultId', 'amount'],
      properties: {
        beneficiaryAddress: {
          type: 'string',
          description: 'Beneficiary Stellar or EVM wallet address',
          examples: ['GBYWLISGOUWQ43VQEGXX6KRGDZ3CKAFFK3JXVLXKDO5TIFJUJ3OHJYOZ'],
        },
        vaultId: {
          type: 'string',
          format: 'uuid',
          description: 'Vault identifier to claim from',
          examples: ['550e8400-e29b-41d4-a716-446655440000'],
        },
        amount: {
          type: 'string',
          description: 'Amount of vested tokens to claim',
          examples: ['2500000000'],
        },
      },
    },
    ClaimResponseDto: {
      type: 'object',
      required: ['success', 'transactionHash', 'claimedAmount'],
      properties: {
        success: {
          type: 'boolean',
          description: 'Whether the claim succeeded',
          examples: [true],
        },
        transactionHash: {
          type: 'string',
          description: 'On-chain transaction hash of the processed claim',
          examples: ['a8f1b3c9e04f2a1d67e8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0'],
        },
        claimedAmount: {
          type: 'string',
          description: 'Claimed token amount in base units',
          examples: ['2500000000'],
        },
      },
    },
    IdentityLinkKeyDto: {
      type: 'object',
      required: ['profileId', 'publicKey'],
      properties: {
        profileId: {
          type: 'string',
          description: 'Identity profile identifier',
          examples: ['prof_01HXYZ987654321'],
        },
        publicKey: {
          type: 'string',
          description: 'Stellar public key to link to the identity profile',
          examples: ['GBYWLISGOUWQ43VQEGXX6KRGDZ3CKAFFK3JXVLXKDO5TIFJUJ3OHJYOZ'],
        },
        vestingSchedule: {
          type: ['string', 'null'],
          description: 'Optional vesting schedule identifier associated with the key',
          examples: ['sched_101'],
        },
      },
    },
    KycEvaluateDto: {
      type: 'object',
      required: ['profileId', 'vestingValueUsd', 'basicChecksPassed'],
      properties: {
        profileId: {
          type: 'string',
          description: 'Identity profile identifier to evaluate',
          examples: ['prof_01HXYZ987654321'],
        },
        vestingValueUsd: {
          type: 'number',
          minimum: 0,
          description: 'Total USD value of the vesting grant under evaluation',
          examples: [50000],
        },
        basicChecksPassed: {
          type: 'boolean',
          description: 'Whether baseline sanction and identity checks passed',
          examples: [true],
        },
      },
    },
    KycWebhookDto: {
      type: 'object',
      required: ['applicantId', 'reviewStatus'],
      properties: {
        applicantId: {
          type: 'string',
          description: 'External KYC provider applicant identifier',
          examples: ['appl_99482716'],
        },
        reviewStatus: {
          type: 'string',
          enum: ['pending', 'completed', 'rejected'],
          description: 'Review status emitted by the KYC provider',
          examples: ['completed'],
        },
      },
    },
    ApiErrorResponseDto: {
      type: 'object',
      required: ['success', 'error'],
      properties: {
        success: {
          type: 'boolean',
          description: 'Indicates failed request execution',
          examples: [false],
        },
        error: {
          type: 'string',
          description: 'Human-readable error message',
          examples: ['Invalid or missing authentication credentials'],
        },
        code: {
          type: ['string', 'null'],
          description: 'Machine-readable error code',
          examples: ['UNAUTHORIZED'],
        },
      },
    },
  };

  const paths = {
    '/api/v1/vaults': {
      get: {
        tags: ['vaults'],
        summary: 'List vesting vaults (v1 — deprecated in favor of v2 cursor pagination)',
        description:
          'Returns vesting vaults filtered by owner or token address. Deprecated in v1; migrate to GET /api/v2/vaults before the Sunset date.',
        operationId: 'VaultsV1Controller_listVaultsV1_v1',
        deprecated: true,
        'x-deprecation-policy': {
          sinceVersion: '1.0.0',
          sunsetDate: 'Wed, 30 Sep 2026 23:59:59 GMT',
          replacementPath: '/api/v2/vaults',
          noticeDays: 90,
        },
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'ownerAddress',
            in: 'query',
            required: false,
            description: 'Filter vaults by owner wallet address',
            schema: {
              type: 'string',
              examples: ['GBYWLISGOUWQ43VQEGXX6KRGDZ3CKAFFK3JXVLXKDO5TIFJUJ3OHJYOZ'],
            },
          },
        ],
        responses: {
          '200': {
            description: 'List of vesting vaults',
            headers: {
              Deprecation: {
                description: 'Indicates that the endpoint is deprecated (RFC 8594)',
                schema: { type: 'string', examples: ['true'] },
              },
              Sunset: {
                description: 'HTTP-date after which the endpoint will be retired (RFC 8594)',
                schema: {
                  type: 'string',
                  format: 'date-time',
                  examples: ['Wed, 30 Sep 2026 23:59:59 GMT'],
                },
              },
            },
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/VaultDto' },
                },
              },
            },
          },
          '401': {
            description: 'Unauthorized request',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ApiErrorResponseDto' },
              },
            },
          },
        },
      },
      post: {
        tags: ['vaults'],
        summary: 'Create a new vesting vault',
        description: 'Registers a new Soroban or EVM vesting vault and initializes its schedule.',
        operationId: 'VaultsV1Controller_createVault_v1',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          description: 'Vesting vault creation payload',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateVaultDto' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Vault created successfully',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/VaultDto' },
              },
            },
          },
          '400': {
            description: 'Validation error in request payload',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ApiErrorResponseDto' },
              },
            },
          },
        },
      },
    },
    '/api/v1/vaults/{id}': {
      get: {
        tags: ['vaults'],
        summary: 'Get vesting vault details by ID',
        description: 'Retrieves a single vesting vault and its schedule metadata by UUID.',
        operationId: 'VaultsV1Controller_getVaultById_v1',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'UUID of the vesting vault',
            schema: {
              type: 'string',
              examples: ['550e8400-e29b-41d4-a716-446655440000'],
            },
          },
        ],
        responses: {
          '200': {
            description: 'Vesting vault details',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/VaultDto' },
              },
            },
          },
          '404': {
            description: 'Vault not found',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ApiErrorResponseDto' },
              },
            },
          },
        },
      },
    },
    '/api/v1/vaults/{id}/claims': {
      post: {
        tags: ['vaults'],
        summary: 'Submit a vested token claim',
        description: 'Processes a beneficiary token claim against an active vesting vault.',
        operationId: 'VaultsV1Controller_submitClaim_v1',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'Vault UUID',
            schema: {
              type: 'string',
              examples: ['550e8400-e29b-41d4-a716-446655440000'],
            },
          },
        ],
        requestBody: {
          required: true,
          description: 'Beneficiary claim payload',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ClaimRequestDto' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Claim processed successfully',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ClaimResponseDto' },
              },
            },
          },
          '400': {
            description: 'Invalid claim parameters or compliance rejection',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ApiErrorResponseDto' },
              },
            },
          },
        },
      },
    },
    '/api/v2/vaults': {
      get: {
        tags: ['vaults'],
        summary: 'List vesting vaults with cursor pagination and liquidity health (v2)',
        description:
          'Stable v2 endpoint returning cursor-paginated vesting vaults with real-time Soroban liquidity status.',
        operationId: 'VaultsV2Controller_listVaultsV2_v2',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'cursor',
            in: 'query',
            required: false,
            description: 'Opaque pagination cursor from the previous page',
            schema: {
              type: 'string',
              examples: ['eyJpZCI6IjU1MGU4NDAwIn0='],
            },
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            description: 'Maximum number of records per page (1–100)',
            schema: {
              type: 'string',
              examples: ['25'],
            },
          },
        ],
        responses: {
          '200': {
            description: 'Cursor-paginated list of vesting vaults',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/VaultDto' },
                },
              },
            },
          },
        },
      },
    },
  };

  return { paths, components: { schemas } };
}

const options = {
  definition: {
    openapi: '3.1.0',
    jsonSchemaDialect: 'https://spec.openapis.org/oas/3.1/dialect/base',
    info: {
      title: 'Verinode Vesting Vault API',
      version: '1.0.0',
      description:
        'OpenAPI 3.1 documentation for the Verinode Vesting Vault system with versioned API paths (/api/v1, /api/v2) and RFC 8594 deprecation headers.',
      contact: {
        name: 'Wavelum / Verinode API Team',
        url: 'https://api.verinode.io/api/docs',
      },
      license: {
        name: 'MIT',
        identifier: 'MIT',
      },
    },
    servers: [
      {
        url: 'http://localhost:3000/api/v1',
        description: 'Development v1 server',
      },
      {
        url: 'http://localhost:3000/api/v2',
        description: 'Development v2 server',
      },
      {
        url: 'https://api.verinode.io/api/v1',
        description: 'Production v1 server',
      },
      {
        url: 'https://api.verinode.io/api/v2',
        description: 'Production v2 server',
      },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
        XUserAddress: {
          type: 'apiKey',
          in: 'header',
          name: 'x-user-address',
        },
      },
    },
  },
  apis: [
    path.join(backendRoot, 'src/**/*.js'),
    path.join(backendRoot, 'src/**/*.ts'),
    path.join(backendRoot, 'src/swagger/swaggerConfig.js'),
  ],
};

function buildOpenApiSpec() {
  const jsdocSpec = swaggerJsdoc(options);
  jsdocSpec.openapi = '3.1.0';
  jsdocSpec.jsonSchemaDialect = 'https://spec.openapis.org/oas/3.1/dialect/base';

  const nestSpec = buildNestDecoratorOpenApiSpec();
  jsdocSpec.paths = {
    ...(jsdocSpec.paths || {}),
    ...(nestSpec.paths || {}),
  };
  jsdocSpec.components = jsdocSpec.components || {};
  jsdocSpec.components.schemas = {
    ...(jsdocSpec.components.schemas || {}),
    ...((nestSpec.components && nestSpec.components.schemas) || {}),
  };

  return jsdocSpec;
}

const specs = buildOpenApiSpec();
specs.buildOpenApiSpec = buildOpenApiSpec;

module.exports = specs;
