import { ApiProperty, ApiPropertyOptional } from '../swagger/swagger.module';

export class VaultDto {
  @ApiProperty({
    description: 'Unique identifier of the vesting vault',
    example: '550e8400-e29b-41d4-a716-446655440000',
    format: 'uuid',
  })
  id!: string;

  @ApiProperty({
    description: 'Smart contract address of the vault on Stellar Soroban or EVM',
    example: 'CA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA',
  })
  address!: string;

  @ApiProperty({
    description: 'Human-readable vault name',
    example: 'Core Contributors Vesting Vault',
  })
  name!: string;

  @ApiProperty({
    description: 'Token contract address being vested',
    example: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
  })
  tokenAddress!: string;

  @ApiProperty({
    description: 'Vault administrator address',
    example: 'GBYWLISGOUWQ43VQEGXX6KRGDZ3CKAFFK3JXVLXKDO5TIFJUJ3OHJYOZ',
  })
  ownerAddress!: string;

  @ApiProperty({
    description: 'Total token allocation in base units',
    example: '1000000000000',
  })
  totalAmount!: string;

  @ApiPropertyOptional({
    description: 'Liquidity status of the vault',
    enum: ['healthy', 'warning', 'critical'],
    example: 'healthy',
    nullable: true,
  })
  liquidityStatus?: string | null;

  @ApiProperty({
    description: 'Creation timestamp in ISO 8601 format',
    format: 'date-time',
    example: '2026-01-01T00:00:00.000Z',
  })
  createdAt!: string;
}

export class CreateVaultDto {
  @ApiProperty({
    description: 'Smart contract address of the vault',
    example: 'CA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA',
  })
  address!: string;

  @ApiProperty({
    description: 'Human-readable name for the vault',
    example: 'Core Contributors Vesting Vault',
  })
  name!: string;

  @ApiProperty({
    description: 'Token contract address being vested',
    example: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
  })
  tokenAddress!: string;

  @ApiProperty({
    description: 'Vault administrator address',
    example: 'GBYWLISGOUWQ43VQEGXX6KRGDZ3CKAFFK3JXVLXKDO5TIFJUJ3OHJYOZ',
  })
  ownerAddress!: string;

  @ApiProperty({
    description: 'Total token allocation in base units',
    example: '1000000000000',
  })
  totalAmount!: string;
}

export class ClaimRequestDto {
  @ApiProperty({
    description: 'Beneficiary Stellar or EVM wallet address',
    example: 'GBYWLISGOUWQ43VQEGXX6KRGDZ3CKAFFK3JXVLXKDO5TIFJUJ3OHJYOZ',
  })
  beneficiaryAddress!: string;

  @ApiProperty({
    description: 'Vault identifier to claim from',
    example: '550e8400-e29b-41d4-a716-446655440000',
    format: 'uuid',
  })
  vaultId!: string;

  @ApiProperty({
    description: 'Amount of vested tokens to claim',
    example: '2500000000',
  })
  amount!: string;
}

export class ClaimResponseDto {
  @ApiProperty({
    description: 'Whether the claim succeeded',
    type: Boolean,
    example: true,
  })
  success!: boolean;

  @ApiProperty({
    description: 'On-chain transaction hash of the processed claim',
    example: 'a8f1b3c9e04f2a1d67e8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0',
  })
  transactionHash!: string;

  @ApiProperty({
    description: 'Claimed token amount in base units',
    example: '2500000000',
  })
  claimedAmount!: string;
}

export class IdentityLinkKeyDto {
  @ApiProperty({
    description: 'Identity profile identifier',
    example: 'prof_01HXYZ987654321',
  })
  profileId!: string;

  @ApiProperty({
    description: 'Stellar public key to link to the identity profile',
    example: 'GBYWLISGOUWQ43VQEGXX6KRGDZ3CKAFFK3JXVLXKDO5TIFJUJ3OHJYOZ',
  })
  publicKey!: string;

  @ApiPropertyOptional({
    description: 'Optional vesting schedule identifier associated with the key',
    example: 'sched_101',
    nullable: true,
  })
  vestingSchedule?: string | null;
}

export class KycEvaluateDto {
  @ApiProperty({
    description: 'Identity profile identifier to evaluate',
    example: 'prof_01HXYZ987654321',
  })
  profileId!: string;

  @ApiProperty({
    description: 'Total USD value of the vesting grant under evaluation',
    type: Number,
    minimum: 0,
    example: 50000,
  })
  vestingValueUsd!: number;

  @ApiProperty({
    description: 'Whether baseline sanction and identity checks passed',
    type: Boolean,
    example: true,
  })
  basicChecksPassed!: boolean;
}

export class KycWebhookDto {
  @ApiProperty({
    description: 'External KYC provider applicant identifier',
    example: 'appl_99482716',
  })
  applicantId!: string;

  @ApiProperty({
    description: 'Review status emitted by the KYC provider',
    enum: ['pending', 'completed', 'rejected'],
    example: 'completed',
  })
  reviewStatus!: string;
}

export class ApiErrorResponseDto {
  @ApiProperty({
    description: 'Indicates failed request execution',
    type: Boolean,
    example: false,
  })
  success!: boolean;

  @ApiProperty({
    description: 'Human-readable error message',
    example: 'Invalid or missing authentication credentials',
  })
  error!: string;

  @ApiPropertyOptional({
    description: 'Machine-readable error code',
    example: 'UNAUTHORIZED',
    nullable: true,
  })
  code?: string | null;
}
