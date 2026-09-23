import { Test, TestingModule } from '@nestjs/testing';
import { InventoryService } from './inventory.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BadRequestException } from '@nestjs/common';
import { MovementReason } from '@prisma/client';
import { expect, describe, it, beforeAll, afterAll } from 'vitest';

describe('InventoryService (e2e)', () => {
  let service: InventoryService;
  let prisma: PrismaService;
  let testProductId: string;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [InventoryService, PrismaService],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
    prisma = module.get<PrismaService>(PrismaService);

    // Clean up
    await prisma.payment.deleteMany();
    await prisma.orderItem.deleteMany();
    await prisma.order.deleteMany();
    await prisma.cartItem.deleteMany();
    await prisma.cart.deleteMany();
    await prisma.stockMovement.deleteMany();
    await prisma.product.deleteMany();
    await prisma.category.deleteMany();

    const cat = await prisma.category.create({ data: { name: 'InvCat', slug: 'inv-cat' } });
    const product = await prisma.product.create({
      data: { name: 'InvProduct', sku: 'SKU-INV', slug: 'inv-product', price: 10, categoryId: cat.id },
    });
    testProductId = product.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('getStock', () => {
    it('should compute correctly from mixed positive and negative movements', async () => {
      await prisma.stockMovement.create({
        data: { productId: testProductId, quantityChange: 50, reason: MovementReason.INITIAL_STOCK },
      });
      await prisma.stockMovement.create({
        data: { productId: testProductId, quantityChange: -15, reason: MovementReason.ORDER },
      });
      await prisma.stockMovement.create({
        data: { productId: testProductId, quantityChange: 5, reason: MovementReason.RETURN },
      });

      const stock = await service.getStock(testProductId);
      expect(stock).toBe(40); // 50 - 15 + 5 = 40
    });
  });

  describe('deductStockInTransaction', () => {
    it('should deduct correctly and write a ledger row', async () => {
      await prisma.$transaction(async (tx) => {
        await service.deductStockInTransaction(tx, testProductId, 10, MovementReason.ORDER, 'order-1');
      });

      const stock = await service.getStock(testProductId);
      expect(stock).toBe(30); // 40 - 10 = 30

      const movement = await prisma.stockMovement.findFirst({
        where: { productId: testProductId, reference: 'order-1', reason: MovementReason.ORDER },
      });
      expect(movement).toBeDefined();
      expect(movement?.quantityChange).toBe(-10);
    });

    it('should refuse to drive stock negative', async () => {
      await expect(
        prisma.$transaction(async (tx) => {
          await service.deductStockInTransaction(tx, testProductId, 100, MovementReason.ORDER, 'order-2');
        })
      ).rejects.toThrow(BadRequestException);
      await expect(
        prisma.$transaction(async (tx) => {
          await service.deductStockInTransaction(tx, testProductId, 100, MovementReason.ORDER, 'order-2');
        })
      ).rejects.toThrow(/Insufficient stock/);
    });
  });

  describe('restoreStock', () => {
    it('should write a compensating positive movement', async () => {
      await prisma.$transaction(async (tx) => {
        await service.restoreStock(tx, testProductId, 10, MovementReason.RETURN, 'order-1-cancel');
      });

      const stock = await service.getStock(testProductId);
      expect(stock).toBe(40); // 30 + 10 = 40

      const movement = await prisma.stockMovement.findFirst({
        where: { productId: testProductId, reference: 'order-1-cancel', reason: MovementReason.RETURN },
      });
      expect(movement).toBeDefined();
      expect(movement?.quantityChange).toBe(10);
    });
  });
});
