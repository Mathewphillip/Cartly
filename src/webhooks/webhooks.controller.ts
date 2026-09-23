import { Controller, Post, Headers, Req, BadRequestException } from '@nestjs/common';
import { WebhooksService } from './webhooks.service.js';
import type { Request } from 'express';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('stripe')
  @ApiOperation({ summary: 'Stripe webhook endpoint' })
  async handleStripeWebhook(
    @Headers('stripe-signature') signature: string,
    @Req() req: Request,
  ) {
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }

    // NestJS with rawBody: true attaches the raw buffer to req.rawBody
    const rawBody = (req as any).rawBody;
    if (!rawBody) {
      throw new BadRequestException('Missing raw body');
    }

    return this.webhooksService.handleStripeWebhook(signature, rawBody);
  }
}
