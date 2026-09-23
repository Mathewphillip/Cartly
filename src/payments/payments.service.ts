import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import Stripe from 'stripe';
import { PaymentStatus, Prisma } from '@prisma/client';

@Injectable()
export class PaymentsService {
  private stripe: Stripe;
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    const apiKey = this.configService.get<string>('STRIPE_SECRET_KEY') || 'sk_test_mock';
    this.stripe = new Stripe(apiKey);
  }

  async createPaymentIntent(userId: string, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (order.userId !== userId) {
      throw new NotFoundException('Order not found'); // Keep it identical for security
    }
    if (order.paymentStatus === PaymentStatus.SUCCEEDED) {
      throw new BadRequestException('Order is already paid');
    }

    // Amount must be in smallest currency unit (e.g. cents)
    const amountInCents = Math.round(order.total.toNumber() * 100);

    const paymentIntent = await this.stripe.paymentIntents.create({
      amount: amountInCents,
      currency: 'usd',
      metadata: {
        orderId: order.id,
        userId: userId,
      },
    });

    // Record the payment intent in DB
    await this.prisma.payment.create({
      data: {
        orderId: order.id,
        providerRefId: paymentIntent.id,
        amount: order.total,
        currency: 'usd',
        status: PaymentStatus.PENDING,
      },
    });

    return {
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    };
  }
}
