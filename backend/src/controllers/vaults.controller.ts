import { Controller, Get, Post, Param, Query, Body, Version } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiBody,
  ApiResponse,
  ApiBearerAuth,
  ApiDeprecated,
} from '../swagger/swagger.module';
import {
  VaultDto,
  CreateVaultDto,
  ClaimRequestDto,
  ClaimResponseDto,
  IdentityLinkKeyDto,
  KycEvaluateDto,
  KycWebhookDto,
  ApiErrorResponseDto,
} from '../dtos/vault.dto';

@Controller({ path: 'vaults', version: '1' })
@ApiTags('vaults')
@ApiBearerAuth()
export class VaultsV1Controller {
  @Get()
  @ApiOperation({
    summary: 'List vesting vaults (v1 — deprecated in favor of v2 cursor pagination)',
    description:
      'Returns vesting vaults filtered by owner or token address. Deprecated in v1; migrate to GET /api/v2/vaults before the Sunset date.',
    deprecated: true,
  })
  @ApiDeprecated({
    sinceVersion: '1.0.0',
    sunsetDate: 'Wed, 30 Sep 2026 23:59:59 GMT',
    replacementPath: '/api/v2/vaults',
    noticeDays: 90,
  })
  @ApiQuery({
    name: 'ownerAddress',
    required: false,
    description: 'Filter vaults by owner wallet address',
    example: 'GBYWLISGOUWQ43VQEGXX6KRGDZ3CKAFFK3JXVLXKDO5TIFJUJ3OHJYOZ',
  })
  @ApiResponse({
    status: 200,
    description: 'List of vesting vaults',
    type: [VaultDto],
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized request',
    type: ApiErrorResponseDto,
  })
  listVaultsV1(@Query('ownerAddress') _ownerAddress?: string): VaultDto[] {
    return [];
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get vesting vault details by ID',
    description: 'Retrieves a single vesting vault and its schedule metadata by UUID.',
  })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'UUID of the vesting vault',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 200,
    description: 'Vesting vault details',
    type: VaultDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Vault not found',
    type: ApiErrorResponseDto,
  })
  getVaultById(@Param('id') id: string): Partial<VaultDto> {
    return { id };
  }

  @Post()
  @ApiOperation({
    summary: 'Create a new vesting vault',
    description: 'Registers a new Soroban or EVM vesting vault and initializes its schedule.',
  })
  @ApiBody({
    type: CreateVaultDto,
    description: 'Vesting vault creation payload',
  })
  @ApiResponse({
    status: 201,
    description: 'Vault created successfully',
    type: VaultDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error in request payload',
    type: ApiErrorResponseDto,
  })
  createVault(@Body() dto: CreateVaultDto): Partial<VaultDto> {
    return { ...dto };
  }

  @Post(':id/claims')
  @ApiOperation({
    summary: 'Submit a vested token claim',
    description: 'Processes a beneficiary token claim against an active vesting vault.',
  })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'Vault UUID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiBody({
    type: ClaimRequestDto,
    description: 'Beneficiary claim payload',
  })
  @ApiResponse({
    status: 200,
    description: 'Claim processed successfully',
    type: ClaimResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid claim parameters or compliance rejection',
    type: ApiErrorResponseDto,
  })
  submitClaim(@Param('id') _id: string, @Body() dto: ClaimRequestDto): ClaimResponseDto {
    return {
      success: true,
      transactionHash: '0x0',
      claimedAmount: dto.amount,
    };
  }
}

@Controller({ path: 'vaults', version: '2' })
@ApiTags('vaults')
@ApiBearerAuth()
export class VaultsV2Controller {
  @Get()
  @Version('2')
  @ApiOperation({
    summary: 'List vesting vaults with cursor pagination and liquidity health (v2)',
    description:
      'Stable v2 endpoint returning cursor-paginated vesting vaults with real-time Soroban liquidity status.',
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Opaque pagination cursor from the previous page',
    example: 'eyJpZCI6IjU1MGU4NDAwIn0=',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Maximum number of records per page (1–100)',
    example: '25',
  })
  @ApiResponse({
    status: 200,
    description: 'Cursor-paginated list of vesting vaults',
    type: [VaultDto],
  })
  listVaultsV2(
    @Query('cursor') _cursor?: string,
    @Query('limit') _limit?: string
  ): VaultDto[] {
    return [];
  }
}

@Controller({ path: 'identity', version: '1' })
@ApiTags('identity')
@ApiBearerAuth()
export class IdentityV1Controller {
  @Post('link-key')
  @ApiOperation({
    summary: 'Link a Stellar public key to an identity profile',
    description: 'Associates a verified wallet public key with an user identity profile.',
  })
  @ApiBody({
    type: IdentityLinkKeyDto,
    description: 'Identity key link payload',
  })
  @ApiResponse({
    status: 200,
    description: 'Public key linked successfully',
    type: IdentityLinkKeyDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid identity profile or public key',
    type: ApiErrorResponseDto,
  })
  linkKey(@Body() dto: IdentityLinkKeyDto): IdentityLinkKeyDto {
    return dto;
  }

  @Post('kyc/evaluate')
  @ApiOperation({
    summary: 'Evaluate KYC risk score for a vesting beneficiary',
    description: 'Calculates KYC risk tier based on USD vesting value and baseline compliance checks.',
  })
  @ApiBody({
    type: KycEvaluateDto,
    description: 'KYC evaluation payload',
  })
  @ApiResponse({
    status: 200,
    description: 'KYC evaluation result',
    type: KycEvaluateDto,
  })
  evaluateKyc(@Body() dto: KycEvaluateDto): KycEvaluateDto {
    return dto;
  }

  @Post('webhook/kyc')
  @ApiOperation({
    summary: 'Process HMAC-signed KYC status webhook',
    description: 'Verifies the x-signature HMAC-SHA256 header and updates customer KYC status.',
  })
  @ApiBody({
    type: KycWebhookDto,
    description: 'KYC provider webhook payload',
  })
  @ApiResponse({
    status: 200,
    description: 'Webhook processed',
    type: KycWebhookDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid webhook HMAC signature',
    type: ApiErrorResponseDto,
  })
  handleKycWebhook(@Body() dto: KycWebhookDto): KycWebhookDto {
    return dto;
  }
}
