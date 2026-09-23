import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { ReservationService } from './reservation.service.js';
import { AddToCartDto } from './dto/add-to-cart.dto.js';
import { UpdateCartItemDto } from './dto/update-cart-item.dto.js';
import { Prisma } from '@prisma/client';

@Injectable()
export class CartService {
  constructor(
    private prisma: PrismaService,
    private inventoryService: InventoryService,
    private reservationService: ReservationService,
  ) {}

  /**
   * Get or create the active cart for a user.
   */
  async getOrCreateCart(userId: string) {
    let cart = await this.prisma.cart.findUnique({
      where: { userId },
      include: {
        items: {
          include: { product: { include: { category: true } } },
        },
      },
    });
    if (!cart) {
      cart = await this.prisma.cart.create({
        data: { userId },
        include: {
          items: {
            include: { product: { include: { category: true } } },
          },
        },
      });
    }
    return cart;
  }

  /**
   * Get cart with calculated totals.
   */
  async getCart(userId: string) {
    const cart = await this.getOrCreateCart(userId);
    return this.enrichCartWithTotals(userId, cart);
  }

  /**
   * Add a product to cart, creating/updating a Redis reservation.
   */
  async addItem(userId: string, dto: AddToCartDto) {
    // 1. Validate product exists and is active
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, isDeleted: false, active: true },
    });
    if (!product) throw new NotFoundException(`Product ${dto.productId} not found or not available`);

    // 2. Check available stock (DB stock minus total reservations from other users)
    const dbStock = await this.inventoryService.getStock(dto.productId);
    const totalReserved = await this.reservationService.getTotalReservedForProduct(dto.productId);
    const myCurrentReservation = await this.reservationService.getReservation(userId, dto.productId);
    // Available = DB stock - reservations from OTHER users
    const availableForMe = dbStock - (totalReserved - myCurrentReservation);

    if (dto.quantity > availableForMe) {
      throw new BadRequestException(
        `Only ${availableForMe} units available for product ${dto.productId}`,
      );
    }

    // 3. Upsert cart item
    const cart = await this.getOrCreateCart(userId);
    const existingItem = cart.items.find((i) => i.productId === dto.productId);
    const newQuantity = (existingItem?.quantity ?? 0) + dto.quantity;

    await this.prisma.cartItem.upsert({
      where: { cartId_productId: { cartId: cart.id, productId: dto.productId } },
      update: { quantity: newQuantity },
      create: { cartId: cart.id, productId: dto.productId, quantity: newQuantity },
    });

    // 4. Set/extend Redis reservation for the full quantity in cart
    await this.reservationService.setReservation(userId, dto.productId, newQuantity);

    return this.getCart(userId);
  }

  /**
   * Update quantity of a cart item. If quantity is 0, removes the item.
   */
  async updateItem(userId: string, dto: UpdateCartItemDto) {
    const cart = await this.getOrCreateCart(userId);
    const item = cart.items.find((i) => i.productId === dto.productId);
    if (!item) throw new NotFoundException(`Item not found in cart`);

    if (dto.quantity === 0) {
      return this.removeItem(userId, dto.productId);
    }

    // Validate new quantity against available stock
    const dbStock = await this.inventoryService.getStock(dto.productId);
    const totalReserved = await this.reservationService.getTotalReservedForProduct(dto.productId);
    const myCurrentReservation = await this.reservationService.getReservation(userId, dto.productId);
    const availableForMe = dbStock - (totalReserved - myCurrentReservation);

    if (dto.quantity > availableForMe) {
      throw new BadRequestException(
        `Only ${availableForMe} units available`,
      );
    }

    await this.prisma.cartItem.update({
      where: { cartId_productId: { cartId: cart.id, productId: dto.productId } },
      data: { quantity: dto.quantity },
    });

    await this.reservationService.setReservation(userId, dto.productId, dto.quantity);

    return this.getCart(userId);
  }

  /**
   * Remove a specific item from the cart and release its reservation.
   */
  async removeItem(userId: string, productId: string) {
    const cart = await this.getOrCreateCart(userId);
    const item = cart.items.find((i) => i.productId === productId);
    if (!item) throw new NotFoundException(`Item not found in cart`);

    await this.prisma.cartItem.delete({
      where: { cartId_productId: { cartId: cart.id, productId } },
    });

    await this.reservationService.releaseReservation(userId, productId);

    return this.getCart(userId);
  }

  /**
   * Clear all items and release all reservations.
   */
  async clearCart(userId: string) {
    const cart = await this.getOrCreateCart(userId);
    await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    await this.reservationService.releaseAllForUser(userId);
    return this.getCart(userId);
  }

  /**
   * Calculate cart totals. Prices are always sourced from the DB.
   */
  private async enrichCartWithTotals(userId: string, cart: any) {
    let subtotal = new Prisma.Decimal(0);
    const enrichedItems = cart.items.map((item: any) => {
      const lineTotal = item.product.price.mul(item.quantity);
      subtotal = subtotal.add(lineTotal);
      return {
        ...item,
        lineTotal,
      };
    });

    return {
      ...cart,
      items: enrichedItems,
      subtotal,
    };
  }
}
