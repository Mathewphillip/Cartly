import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateCouponDto } from './dto/create-coupon.dto.js';
import { DiscountType, Prisma } from '@prisma/client';

@Injectable()
export class CouponsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async findOne(id: string) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id } });
    if (!coupon) throw new NotFoundException(`Coupon ${id} not found`);
    return coupon;
  }

  async findByCode(code: string) {
    return this.prisma.coupon.findUnique({ where: { code: code.toUpperCase() } });
  }

  async create(dto: CreateCouponDto) {
    const code = dto.code.toUpperCase();
    const existing = await this.prisma.coupon.findUnique({ where: { code } });
    if (existing) throw new ConflictException('Coupon code already exists');

    return this.prisma.coupon.create({
      data: {
        code,
        discountType: dto.discountType,
        value: new Prisma.Decimal(dto.value),
        minOrderValue: dto.minOrderValue ? new Prisma.Decimal(dto.minOrderValue) : null,
        usageLimit: dto.usageLimit ?? null,
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
        active: dto.active ?? true,
      },
    });
  }

  async deactivate(id: string) {
    await this.findOne(id);
    return this.prisma.coupon.update({ where: { id }, data: { active: false } });
  }

  /**
   * Validate a coupon against an order subtotal.
   * Returns the validated coupon record or throws.
   *
   * This is called during checkout — it does NOT increment usageCount.
   * That happens transactionally when the order is created.
   */
  async validateCoupon(code: string, orderSubtotal: Prisma.Decimal) {
    const coupon = await this.findByCode(code);

    if (!coupon) throw new BadRequestException(`Coupon '${code}' does not exist`);
    if (!coupon.active) throw new BadRequestException(`Coupon '${code}' is not active`);
    if (coupon.expiryDate && coupon.expiryDate < new Date()) {
      throw new BadRequestException(`Coupon '${code}' has expired`);
    }
    if (coupon.usageLimit !== null && coupon.usageCount >= coupon.usageLimit) {
      throw new BadRequestException(`Coupon '${code}' has reached its usage limit`);
    }
    if (coupon.minOrderValue && orderSubtotal.lt(coupon.minOrderValue)) {
      throw new BadRequestException(
        `Minimum order value for this coupon is ${coupon.minOrderValue}`,
      );
    }

    return coupon;
  }

  /**
   * Calculate discount amount from a validated coupon.
   * Ensures discount never exceeds the order total.
   */
  calculateDiscount(
    coupon: { discountType: DiscountType; value: Prisma.Decimal },
    subtotal: Prisma.Decimal,
  ): Prisma.Decimal {
    let discount: Prisma.Decimal;

    if (coupon.discountType === DiscountType.PERCENTAGE) {
      discount = subtotal.mul(coupon.value).div(100);
    } else {
      discount = coupon.value;
    }

    // Discount cannot exceed subtotal (no negative totals)
    return discount.gt(subtotal) ? subtotal : discount;
  }
}
