import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import Stripe from 'stripe';
import { OrderStatus, PaymentStatus, MovementReason, Prisma } from '@prisma/client';

@Injectable()
export class WebhooksService {
  private stripe: Stripe;
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private ordersService: OrdersService,
    private inventoryService: InventoryService,
  ) {
    const apiKey = this.configService.get<string>('STRIPE_SECRET_KEY') || 'sk_test_mock';
    this.stripe = new Stripe(apiKey);
  }

  async handleStripeWebhook(signature: string, payload: Buffer) {
    const webhookSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!webhookSecret) {
      this.logger.error('STRIPE_WEBHOOK_SECRET is not configured');
      throw new BadRequestException('Webhook configuration error');
    }

    let event: Stripe.Event;

    try {
      event = this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    } catch (err: any) {
      this.logger.error(`Webhook signature verification failed: ${err.message}`);
      throw new BadRequestException(`Webhook Error: ${err.message}`);
    }

    // Process the event
    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.handlePaymentIntentSucceeded(event.id, event.data.object as Stripe.PaymentIntent);
        break;
      case 'payment_intent.payment_failed':
        await this.handlePaymentIntentFailed(event.id, event.data.object as Stripe.PaymentIntent);
        break;
      default:
        this.logger.debug(`Unhandled event type: ${event.type}`);
    }

    return { received: true };
  }

  private async handlePaymentIntentSucceeded(eventId: string, paymentIntent: Stripe.PaymentIntent) {
    const orderId = paymentIntent.metadata.orderId;
    if (!orderId) {
      this.logger.warn(`PaymentIntent ${paymentIntent.id} has no orderId in metadata`);
      return;
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        // Idempotency constraint insertion FIRST
        await tx.processedWebhook.create({ data: { id: eventId } });

        // 1. Update Payment status
        await tx.payment.updateMany({
          where: { providerRefId: paymentIntent.id },
          data: { status: PaymentStatus.SUCCEEDED },
        });

        // 2. Update Order status
        await tx.order.update({
          where: { id: orderId },
          data: {
            paymentStatus: PaymentStatus.SUCCEEDED,
            status: OrderStatus.PROCESSING,
          },
        });
      });
      this.logger.log(`Payment succeeded for Order ${orderId}`);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.logger.log(`Webhook event ${eventId} already processed (idempotency triggered)`);
        return; // Safe to ignore duplicate delivery
      }
      throw err;
    }
  }

  private async handlePaymentIntentFailed(eventId: string, paymentIntent: Stripe.PaymentIntent) {
    const orderId = paymentIntent.metadata.orderId;
    if (!orderId) return;

    try {
      await this.prisma.$transaction(async (tx) => {
        // Idempotency constraint insertion FIRST
        await tx.processedWebhook.create({ data: { id: eventId } });

        // 1. Update Payment
        await tx.payment.updateMany({
          where: { providerRefId: paymentIntent.id },
          data: { status: PaymentStatus.FAILED },
        });

        // 2. Update Order
        const order = await tx.order.update({
          where: { id: orderId },
          data: {
            paymentStatus: PaymentStatus.FAILED,
            status: OrderStatus.CANCELLED,
          },
          include: { items: true },
        });

        // 3. Restore inventory since order is cancelled
        for (const item of order.items) {
          await this.inventoryService.restoreStock(
            tx,
            item.productId,
            item.quantity,
            MovementReason.RETURN,
            `Payment failed for Order ${orderId}`,
          );
        }
      });
      this.logger.log(`Payment failed for Order ${orderId}`);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.logger.log(`Webhook event ${eventId} already processed (idempotency triggered)`);
        return; // Safe to ignore duplicate delivery
      }
      throw err;
    }
  }
}

