import { Test, TestingModule } from '@nestjs/testing';
import { OrdersService } from './orders.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CartService } from '../cart/cart.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { CouponsService } from '../coupons/coupons.service.js';
import { ReservationService } from '../cart/reservation.service.js';
import { BadRequestException } from '@nestjs/common';
import { Role, DiscountType, MovementReason } from '@prisma/client';
import { vi, expect, describe, it, beforeAll, afterAll } from 'vitest';
import { Prisma } from '@prisma/client';

describe('OrdersService (e2e)', () => {
  let service: OrdersService;
  let prisma: PrismaService;
  let reservationService: ReservationService;

  let testUserId: string;
  let product1Id: string;
  let product2Id: string;
  let couponId: string;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        PrismaService,
        CartService,
        InventoryService,
        CouponsService,
        {
          provide: ReservationService,
          useValue: {
            releaseAllForUser: vi.fn(),
            getReservation: vi.fn(),
            setReservation: vi.fn(),
            getTotalReservedForProduct: vi.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
    prisma = module.get<PrismaService>(PrismaService);
    reservationService = module.get<ReservationService>(ReservationService);

    // Clean up
    await prisma.stockMovement.deleteMany();
    await prisma.payment.deleteMany();
    await prisma.orderItem.deleteMany();
    await prisma.order.deleteMany();
    await prisma.cartItem.deleteMany();
    await prisma.cart.deleteMany();
    await prisma.stockMovement.deleteMany();
    await prisma.product.deleteMany();
    await prisma.category.deleteMany();
    await prisma.coupon.deleteMany();
    await prisma.user.deleteMany();

    const user = await prisma.user.create({
      data: { email: 'checkout@cartly.test', passwordHash: 'hash', role: Role.CUSTOMER },
    });
    testUserId = user.id;

    const cat = await prisma.category.create({ data: { name: 'Cat', slug: 'cat' } });
    const p1 = await prisma.product.create({
      data: { name: 'P1', sku: 'SKU-1', slug: 'p1', price: 50, categoryId: cat.id },
    });
    const p2 = await prisma.product.create({
      data: { name: 'P2', sku: 'SKU-2', slug: 'p2', price: 100, categoryId: cat.id },
    });
    product1Id = p1.id;
    product2Id = p2.id;

    const coupon = await prisma.coupon.create({
      data: { code: 'HALF', discountType: DiscountType.PERCENTAGE, value: 50, usageLimit: 1, usageCount: 0, active: true },
    });
    couponId = coupon.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('checkout transaction', () => {
    it('should rollback entirely if inventory is insufficient (Atomic Rollback)', async () => {
      // Seed Cart
      const cart = await prisma.cart.create({ data: { userId: testUserId } });
      await prisma.cartItem.create({ data: { cartId: cart.id, productId: product1Id, quantity: 1 } });
      await prisma.cartItem.create({ data: { cartId: cart.id, productId: product2Id, quantity: 10 } }); // We will only give it 5 stock

      // Seed Stock
      await prisma.stockMovement.create({ data: { productId: product1Id, quantityChange: 10, reason: MovementReason.INITIAL_STOCK } });
      await prisma.stockMovement.create({ data: { productId: product2Id, quantityChange: 5, reason: MovementReason.INITIAL_STOCK } });

      // Attempt checkout
      await expect(service.checkout(testUserId)).rejects.toThrow(/Insufficient stock/);

      // ASSERTIONS
      // 1. Order was NOT created
      const orders = await prisma.order.findMany({ where: { userId: testUserId } });
      expect(orders.length).toBe(0);

      // 2. Stock was NOT deducted for ANY item
      const movements1 = await prisma.stockMovement.findMany({ where: { productId: product1Id } });
      expect(movements1.length).toBe(1); // Only initial stock
      const movements2 = await prisma.stockMovement.findMany({ where: { productId: product2Id } });
      expect(movements2.length).toBe(1); // Only initial stock

      // 3. Cart is NOT cleared
      const cartItems = await prisma.cartItem.findMany({ where: { cartId: cart.id } });
      expect(cartItems.length).toBe(2);
    });

    it('should complete checkout happy path with coupon application', async () => {
      // Fix stock for P2 so it succeeds
      await prisma.stockMovement.create({ data: { productId: product2Id, quantityChange: 10, reason: MovementReason.INITIAL_STOCK } });

      // We still have the cart from previous test
      const order = await service.checkout(testUserId, 'HALF');

      // ASSERTIONS
      expect(order).toBeDefined();
      expect(order.total.toNumber()).toBe(525); // (50*1) + (100*10) = 1050 / 2 = 525
      
      // Stock deducted
      const movements1 = await prisma.stockMovement.findMany({ where: { productId: product1Id, reason: MovementReason.ORDER } });
      expect(movements1.length).toBe(1);
      expect(movements1[0].quantityChange).toBe(-1);

      // Cart cleared
      const cartItems = await prisma.cartItem.findMany({ where: { cart: { userId: testUserId } } });
      expect(cartItems.length).toBe(0);

      // Redis reservations released
      expect(reservationService.releaseAllForUser).toHaveBeenCalledWith(testUserId);
      
      // Coupon usage incremented
      const coupon = await prisma.coupon.findUnique({ where: { code: 'HALF' } });
      expect(coupon?.usageCount).toBe(1);
    });

    it('should reject checkout if coupon is exhausted', async () => {
      // Re-seed Cart
      const cart = await prisma.cart.findUnique({ where: { userId: testUserId } });
      await prisma.cartItem.create({ data: { cartId: cart!.id, productId: product1Id, quantity: 1 } });

      // Attempt checkout with exhausted coupon
      await expect(service.checkout(testUserId, 'HALF')).rejects.toThrow(/reached its usage limit/);

      // Assert no new order created
      const orders = await prisma.order.findMany({ where: { userId: testUserId } });
      expect(orders.length).toBe(1); // Only the one from the previous test
    });
  });
});
