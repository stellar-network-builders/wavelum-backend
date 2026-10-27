import { Module } from '@nestjs/common';
import { MetricsModule } from './metrics/metrics.module';
import { WorkersModule } from './workers/workers.module';
import { OpenApiSwaggerModule } from './swagger/swagger.module';
import {
  VaultsV1Controller,
  VaultsV2Controller,
  IdentityV1Controller,
} from './controllers/vaults.controller';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nestjs-redis/throttler-storage';
import Redis from 'ioredis';

@Module({
  imports: [
    MetricsModule,
    WorkersModule,
    OpenApiSwaggerModule,
    ThrottlerModule.forRoot({
      throttlers: [
        {
          name: 'global',
          ttl: 60000,
          limit: 100,
        },
        {
          name: 'auth',
          ttl: 60000,
          limit: 10,
        }
      ],
      storage: new ThrottlerStorageRedisService(new Redis(process.env.REDIS_URL || 'redis://localhost:6379')),
    }),
  ],
  controllers: [VaultsV1Controller, VaultsV2Controller, IdentityV1Controller],
})
export class AppModule {}
