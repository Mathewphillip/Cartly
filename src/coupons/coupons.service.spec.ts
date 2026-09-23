import { Test, TestingModule } from '@nestjs/testing';
import { CouponsService } from './coupons.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BadRequestException } from '@nestjs/common';
import { DiscountType, Prisma } from '@prisma/client';
import { vi, expect, describe, it, beforeEach } from 'vitest';

describe('CouponsService', () => {
  let service: CouponsService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CouponsService,
        {
          provide: PrismaService,
          useValue: {
            coupon: { findUnique: vi.fn() },
          },
        },
      ],
    }).compile();

    service = module.get<CouponsService>(CouponsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('validateCoupon Usage Limit', () => {
    it('should allow usage when count is below limit (Nth use)', async () => {
      const validCoupon = {
        id: 'c1',
        code: 'SAVE10',
        active: true,
        expiryDate: new Date('2099-01-01'),
        usageLimit: 5,
        usageCount: 4, // 4 used out of 5
        minOrderValue: new Prisma.Decimal(0),
        discountType: DiscountType.PERCENTAGE,
        value: new Prisma.Decimal(10),
      };

      vi.spyOn(prisma.coupon, 'findUnique').mockResolvedValue(validCoupon as any);

      await expect(service.validateCoupon('SAVE10', new Prisma.Decimal(100)))
        .resolves.toEqual(validCoupon);
    });

    it('should reject usage when count equals limit (N+1th use)', async () => {
      const exhaustedCoupon = {
        id: 'c1',
        code: 'SAVE10',
        active: true,
        expiryDate: new Date('2099-01-01'),
        usageLimit: 5,
        usageCount: 5, // 5 used out of 5
        minOrderValue: new Prisma.Decimal(0),
        discountType: DiscountType.PERCENTAGE,
        value: new Prisma.Decimal(10),
      };

      vi.spyOn(prisma.coupon, 'findUnique').mockResolvedValue(exhaustedCoupon as any);

      await expect(service.validateCoupon('SAVE10', new Prisma.Decimal(100)))
        .rejects.toThrow(BadRequestException);
      await expect(service.validateCoupon('SAVE10', new Prisma.Decimal(100)))
        .rejects.toThrow('Coupon \'SAVE10\' has reached its usage limit');
    });
  });
});
