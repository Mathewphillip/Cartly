import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CartService } from '../cart/cart.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { CouponsService } from '../coupons/coupons.service.js';
import { ReservationService } from '../cart/reservation.service.js';
import { Prisma, OrderStatus, PaymentStatus, MovementReason } from '@prisma/client';

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private cartService: CartService,
    private inventoryService: InventoryService,
    private couponsService: CouponsService,
    private reservationService: ReservationService,
  ) {}

  /**
   * Checkout: Converts cart to order transactionally.
   * 1. Validates cart
   * 2. Validates coupon
   * 3. Locks and deducts inventory (throws if insufficient)
   * 4. Creates Order and OrderItems
   * 5. Increments coupon usage
   * 6. Clears cart
   * 7. Releases Redis reservations
   */
  async checkout(userId: string, couponCode?: string) {
    const cart = await this.cartService.getCart(userId);
    if (!cart.items || cart.items.length === 0) {
      throw new BadRequestException('Cart is empty');
    }

    return this.prisma.$transaction(
      async (tx) => {
        // 1. Calculate Subtotal
        let subtotal = new Prisma.Decimal(0);
        for (const item of cart.items) {
          subtotal = subtotal.add(item.lineTotal);
        }

        // 2. Validate and apply coupon
        let discount = new Prisma.Decimal(0);
        let couponId: string | undefined;

        if (couponCode) {
          const coupon = await this.couponsService.validateCoupon(couponCode, subtotal);
          discount = this.couponsService.calculateDiscount(coupon, subtotal);
          couponId = coupon.id;

          // Increment usage in transaction
          await tx.coupon.update({
            where: { id: coupon.id },
            data: { usageCount: { increment: 1 } },
          });
        }

        const total = subtotal.sub(discount);

        // 3. Deduct Inventory Safely
        for (const item of cart.items) {
          await this.inventoryService.deductStockInTransaction(
            tx,
            item.productId,
            item.quantity,
            MovementReason.ORDER,
            `Checkout for user ${userId}`,
          );
        }

        // 4. Create Order
        const order = await tx.order.create({
          data: {
            userId,
            subtotal,
            discount,
            total,
            status: OrderStatus.PENDING_PAYMENT,
            paymentStatus: PaymentStatus.PENDING,
            couponId,
            items: {
              create: cart.items.map((item: any) => ({
                productId: item.productId,
                productNameSnapshot: item.product.name,
                unitPriceSnapshot: item.product.price,
                quantity: item.quantity,
                lineTotal: item.lineTotal,
              })),
            },
          },
          include: { items: true, coupon: true },
        });

        // 5. Clear DB Cart
        await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

        return order;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 10000,
      },
    ).then(async (order) => {
      // 6. Release Redis reservations post-transaction success
      await this.reservationService.releaseAllForUser(userId);
      return order;
    });
  }

  async findMyOrders(userId: string) {
    return this.prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { items: { include: { product: true } }, coupon: true },
    });
  }

  async findOrderById(userId: string, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: true } }, coupon: true },
    });
    if (!order || order.userId !== userId) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }

  // Admin methods
  async findAllOrders() {
    return this.prisma.order.findMany({
      orderBy: { createdAt: 'desc' },
      include: { user: true, items: true },
    });
  }

  async updateOrderStatus(orderId: string, status: OrderStatus) {
    return this.prisma.order.update({
      where: { id: orderId },
      data: { status },
    });
  }
}
