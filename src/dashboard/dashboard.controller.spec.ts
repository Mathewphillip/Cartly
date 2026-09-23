import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DashboardModule } from './dashboard.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role, OrderStatus, PaymentStatus, MovementReason } from '@prisma/client';
import { vi, expect, describe, it, beforeAll, afterAll } from 'vitest';

describe('Dashboard API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let adminToken: string;
  let customerToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [DashboardModule, PrismaModule],
      providers: [
        {
          provide: ConfigService,
          useValue: { get: vi.fn().mockReturnValue('secret') },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    jwtService = app.get(JwtService);

    // Clean up
    await prisma.stockMovement.deleteMany();
    await prisma.payment.deleteMany();
    await prisma.cartItem.deleteMany();
    await prisma.cart.deleteMany();
    await prisma.orderItem.deleteMany();
    await prisma.order.deleteMany();
    await prisma.product.deleteMany();
    await prisma.category.deleteMany();
    await prisma.user.deleteMany();

    // Create Admin and Customer Users
    const adminUser = await prisma.user.create({
      data: { email: 'admin@cartly.test', passwordHash: 'hash', role: Role.ADMIN },
    });
    const customerUser = await prisma.user.create({
      data: { email: 'customer@cartly.test', passwordHash: 'hash', role: Role.CUSTOMER },
    });

    adminToken = jwtService.sign(
      { sub: adminUser.id, email: adminUser.email, role: adminUser.role },
      { secret: process.env.JWT_ACCESS_SECRET || 'access_secret', expiresIn: '1h' }
    );
    customerToken = jwtService.sign(
      { sub: customerUser.id, email: customerUser.email, role: customerUser.role },
      { secret: process.env.JWT_ACCESS_SECRET || 'access_secret', expiresIn: '1h' }
    );
  });

  afterAll(async () => {
    await app.close();
  });

  describe('RBAC Verification', () => {
    it('should reject CUSTOMER role with 403 Forbidden', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/dashboard/orders-summary')
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(403);
    });

    it('should reject unauthenticated requests with 401', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/dashboard/orders-summary')
        .expect(401);
    });

    it('should allow ADMIN role with 200 OK', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/dashboard/orders-summary')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });
  });

  describe('Real DB Aggregations', () => {
    beforeAll(async () => {
      // Seed Category
      const cat = await prisma.category.create({ data: { name: 'DashCat', slug: 'dash-cat' } });

      // Seed Products
      const p1 = await prisma.product.create({
        data: { name: 'P1', sku: 'SKU-D1', slug: 'p1', price: 10, categoryId: cat.id, lowStockThreshold: 5 },
      });
      const p2 = await prisma.product.create({
        data: { name: 'P2', sku: 'SKU-D2', slug: 'p2', price: 20, categoryId: cat.id, lowStockThreshold: 10 },
      });

      // Seed Stock Movements
      await prisma.stockMovement.create({
        data: { productId: p1.id, quantityChange: 20, reason: MovementReason.INITIAL_STOCK },
      });
      await prisma.stockMovement.create({
        data: { productId: p1.id, quantityChange: -16, reason: MovementReason.ORDER },
      }); // Net stock = 4 (Below threshold 5)

      await prisma.stockMovement.create({
        data: { productId: p2.id, quantityChange: 30, reason: MovementReason.INITIAL_STOCK },
      }); // Net stock = 30 (Above threshold 10)

      // Seed Orders
      const customer = await prisma.user.findUnique({ where: { email: 'customer@cartly.test' } });
      await prisma.order.create({
        data: { userId: customer!.id, status: OrderStatus.PAID, total: 100, subtotal: 100, paymentStatus: 'SUCCEEDED' },
      });
      await prisma.order.create({
        data: { userId: customer!.id, status: OrderStatus.PAID, total: 50, subtotal: 50, paymentStatus: 'SUCCEEDED' },
      });
      await prisma.order.create({
        data: { userId: customer!.id, status: OrderStatus.CANCELLED, total: 200, subtotal: 200, paymentStatus: 'FAILED' },
      });

      // Seed Payments
      const orders = await prisma.order.findMany();
      await prisma.payment.create({
        data: { orderId: orders[0].id, amount: 100, status: PaymentStatus.SUCCEEDED, providerRefId: 'pi_1' },
      });
      await prisma.payment.create({
        data: { orderId: orders[1].id, amount: 50, status: PaymentStatus.SUCCEEDED, providerRefId: 'pi_2' },
      });
      await prisma.payment.create({
        data: { orderId: orders[2].id, amount: 200, status: PaymentStatus.FAILED, providerRefId: 'pi_3' },
      });
    });

    it('GET /orders-summary should group counts correctly', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/dashboard/orders-summary')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const paidGroup = res.body.find((g: any) => g.status === 'PAID');
      const cancelledGroup = res.body.find((g: any) => g.status === 'CANCELLED');
      
      expect(paidGroup?.count).toBe(2);
      expect(cancelledGroup?.count).toBe(1);
    });

    it('GET /revenue-summary should sum only SUCCEEDED payments', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/dashboard/revenue-summary')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // Only 100 + 50 = 150 (ignores the 200 FAILED payment)
      expect(Number(res.body.totalRevenue)).toBe(150);
    });

    it('GET /low-stock should use N+1 fixed aggregate and return only below-threshold products', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/dashboard/low-stock')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // P1 has 4 stock (threshold 5) -> should be returned
      // P2 has 30 stock (threshold 10) -> should be filtered out
      expect(res.body.length).toBe(1);
      expect(res.body[0].sku).toBe('SKU-D1');
      expect(res.body[0].currentStock).toBe(4);
    });
  });
});
