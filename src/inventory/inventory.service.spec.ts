import { Test, TestingModule } from '@nestjs/testing';
import { InventoryService } from './inventory.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MovementReason } from '@prisma/client';
import { expect, describe, it, beforeAll, afterAll, beforeEach } from 'vitest';

describe('InventoryService (e2e)', () => {
  let service: InventoryService;
  let prisma: PrismaService;
  let testProductId: string;
  let emptyProductId: string;
  let categoryId: string;

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
    categoryId = cat.id;
    const product = await prisma.product.create({
      data: { name: 'InvProduct', sku: 'SKU-INV', slug: 'inv-product', price: 10, categoryId: cat.id },
    });
    testProductId = product.id;

    const emptyProduct = await prisma.product.create({
      data: { name: 'EmptyProduct', sku: 'SKU-EMPTY', slug: 'empty-product', price: 10, categoryId: cat.id },
    });
    emptyProductId = emptyProduct.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('getStock & getStockForProducts', () => {
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

    it('should return 0 for a product with zero movements', async () => {
      const stock = await service.getStock(emptyProductId);
      expect(stock).toBe(0);
    });

    it('getStockForProducts should return map including 0 for products with no movements', async () => {
      const map = await service.getStockForProducts([testProductId, emptyProductId]);
      expect(map[testProductId]).toBe(40);
      expect(map[emptyProductId]).toBe(0);
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
    });

    it('should rollback deduction if a later step in transaction fails', async () => {
      const stockBefore = await service.getStock(testProductId);
      
      await expect(
        prisma.$transaction(async (tx) => {
          await service.deductStockInTransaction(tx, testProductId, 5, MovementReason.ORDER, 'order-fail');
          throw new Error('Deliberate transaction failure');
        })
      ).rejects.toThrow('Deliberate transaction failure');

      // Stock should remain unchanged because the transaction rolled back
      const stockAfter = await service.getStock(testProductId);
      expect(stockAfter).toBe(stockBefore);
      
      const movement = await prisma.stockMovement.findFirst({
        where: { reference: 'order-fail' },
      });
      expect(movement).toBeNull();
    });
  });

  describe('restoreStock & addMovement', () => {
    it('should write a compensating positive movement within a transaction (matching webhook failure pattern)', async () => {
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

    it('addMovement should throw if product does not exist', async () => {
      await expect(
        service.addMovement('non-existent', 10, MovementReason.ADJUSTMENT)
      ).rejects.toThrow(NotFoundException);
    });

    it('addMovement should add movement outside transaction', async () => {
      await service.addMovement(testProductId, 2, MovementReason.ADJUSTMENT, 'manual-add');
      const stock = await service.getStock(testProductId);
      expect(stock).toBe(42);
    });
  });

  describe('adjustStock', () => {
    it('should adjust stock and verify product', async () => {
      await service.adjustStock({
        productId: testProductId,
        quantityChange: 8,
        reason: MovementReason.ADJUSTMENT,
        reference: 'adjust-1'
      });
      const stock = await service.getStock(testProductId);
      expect(stock).toBe(50);
    });

    it('should throw NotFoundException if product is missing', async () => {
      await expect(
        service.adjustStock({
          productId: 'missing-id',
          quantityChange: 1,
          reason: MovementReason.ADJUSTMENT
        })
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getMovements & getLowStockReport', () => {
    it('getMovements should return product movements sorted by descending date', async () => {
      const movements = await service.getMovements(testProductId);
      expect(movements.length).toBeGreaterThan(0);
      expect(movements[0].productId).toBe(testProductId);
      if (movements.length > 1) {
        expect(movements[0].createdAt.getTime()).toBeGreaterThanOrEqual(movements[1].createdAt.getTime());
      }
    });

    it('getMovements should throw NotFoundException if product missing', async () => {
      await expect(service.getMovements('missing-id')).rejects.toThrow(NotFoundException);
    });

    it('getLowStockReport should return products under threshold', async () => {
      // We need a product that actually has a movement but its total stock is low.
      const lowStockProduct = await prisma.product.create({
        data: { name: 'LowStock', sku: 'SKU-LOW', slug: 'low-stock', price: 10, categoryId }
      });
      await prisma.stockMovement.create({
        data: { productId: lowStockProduct.id, quantityChange: 2, reason: MovementReason.INITIAL_STOCK }
      });

      // testProductId has 50 stock. 50 > 10, so it shouldn't appear
      const report = await service.getLowStockReport(10);
      
      const lowStockItem = report.find(r => r.id === lowStockProduct.id);
      expect(lowStockItem).toBeDefined();
      expect(lowStockItem?.currentStock).toBe(2);

      const testProductItem = report.find(r => r.id === testProductId);
      expect(testProductItem).toBeUndefined();
    });

    it('getLowStockReport should return empty array if no low stock', async () => {
      const report = await service.getLowStockReport(-1); // impossible threshold for 0 stock
      expect(report.length).toBe(0);
    });
  });
});
