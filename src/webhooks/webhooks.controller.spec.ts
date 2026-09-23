import { Test, TestingModule } from '@nestjs/testing';
import { WebhooksController } from './webhooks.controller.js';
import { WebhooksService } from './webhooks.service.js';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { vi, expect, describe, it, beforeEach } from 'vitest';

describe('WebhooksController', () => {
  let controller: WebhooksController;
  let service: WebhooksService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [
        WebhooksService,
        {
          provide: ConfigService,
          useValue: { get: vi.fn().mockReturnValue('sk_test_mock') },
        },
        {
          provide: PrismaService,
          useValue: {
            $transaction: vi.fn().mockImplementation(async (cb) => {
              // Mock a transaction runner that directly executes the callback
              return cb({
                processedWebhook: { create: vi.fn() },
                payment: { updateMany: vi.fn() },
                order: { update: vi.fn().mockResolvedValue({ items: [] }) },
              });
            }),
          },
        },
        { provide: OrdersService, useValue: {} },
        { provide: InventoryService, useValue: { restoreStock: vi.fn() } },
      ],
    }).compile();

    controller = module.get<WebhooksController>(WebhooksController);
    service = module.get<WebhooksService>(WebhooksService);
    prisma = module.get<PrismaService>(PrismaService);

    // Mock the stripe signature validation to bypass actual crypto for unit tests
    (service as any).stripe = {
      webhooks: {
        constructEvent: vi.fn(),
      },
    };
  });

  describe('Signature Rejection', () => {
    it('should throw BadRequestException if signature is missing', async () => {
      await expect(
        controller.handleStripeWebhook('', { rawBody: Buffer.from('') } as any)
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if constructEvent fails (invalid signature)', async () => {
      ((service as any).stripe.webhooks.constructEvent as any).mockImplementation(() => {
        throw new Error('Invalid signature');
      });

      await expect(
        controller.handleStripeWebhook('bad_sig', { rawBody: Buffer.from('data') } as any)
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Duplicate Delivery Idempotency', () => {
    it('should only process an event once, gracefully ignoring duplicates via P2002', async () => {
      const eventId = 'evt_123';
      const mockEvent = {
        id: eventId,
        type: 'payment_intent.succeeded',
        data: {
          object: { id: 'pi_123', metadata: { orderId: 'ord_1' } },
        },
      };

      ((service as any).stripe.webhooks.constructEvent as any).mockReturnValue(mockEvent);

      // Simulate first call succeeding normally
      await controller.handleStripeWebhook('valid_sig', { rawBody: Buffer.from('') } as any);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);

      // Simulate second call throwing P2002 from Prisma (unique constraint violation)
      vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('', { code: 'P2002', clientVersion: '1.0' })
      );

      // Should NOT throw an exception, it should catch and return quietly
      await expect(
        controller.handleStripeWebhook('valid_sig', { rawBody: Buffer.from('') } as any)
      ).resolves.toEqual({ received: true });

      // Transaction was initiated a second time (where it threw), meaning 2 attempts
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });
  });
});
