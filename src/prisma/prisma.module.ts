import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaService } from './prisma.service.js';

@Module({
  imports: [AuthModule],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
