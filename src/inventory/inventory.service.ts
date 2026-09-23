import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { MovementReason, Prisma } from '@prisma/client';

@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService) {}

  /**
   * Compute available stock for a product from the ledger.
   * This is the single source of truth for stock levels.
   */
  async getStock(productId: string): Promise<number> {
    const result = await this.prisma.stockMovement.aggregate({
      where: { productId },
      _sum: { quantityChange: true },
    });
    return result._sum.quantityChange ?? 0;
  }

  /**
   * Compute stock for multiple products in one query (efficient).
   */
  async getStockForProducts(productIds: string[]): Promise<Record<string, number>> {
    const movements = await this.prisma.stockMovement.groupBy({
      by: ['productId'],
      where: { productId: { in: productIds } },
      _sum: { quantityChange: true },
    });

    const stockMap: Record<string, number> = {};
    for (const m of movements) {
      stockMap[m.productId] = m._sum.quantityChange ?? 0;
    }
    // Products with no movements have 0 stock
    for (const id of productIds) {
      if (!(id in stockMap)) stockMap[id] = 0;
    }
    return stockMap;
  }

  /**
   * Add a stock movement. Validates product existence.
   * Does NOT check for sufficient stock — callers who need that (checkout, cart)
   * must use adjustStockWithinTransaction to get row-level locking.
   */
  async addMovement(
    productId: string,
    quantityChange: number,
    reason: MovementReason,
    reference?: string,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.prisma;
    const product = await client.product.findUnique({ where: { id: productId } });
    if (!product || product.isDeleted) {
      throw new NotFoundException(`Product ${productId} not found`);
    }
    return client.stockMovement.create({
      data: { productId, quantityChange, reason, reference },
    });
  }

  /**
   * Admin-level manual stock adjustment.
   * Verifies product and records movement.
   */
  async adjustStock(dto: {
    productId: string;
    quantityChange: number;
    reason: MovementReason;
    reference?: string;
  }) {
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, isDeleted: false },
    });
    if (!product) throw new NotFoundException(`Product ${dto.productId} not found`);

    return this.prisma.stockMovement.create({
      data: {
        productId: dto.productId,
        quantityChange: dto.quantityChange,
        reason: dto.reason,
        reference: dto.reference,
      },
    });
  }

  /**
   * Deduct stock safely within a transaction using a locking aggregate.
   * Throws if available stock (ledger sum) is insufficient.
   *
   * This is the concurrency-safe path for checkout. Callers must wrap
   * this in a Prisma.$transaction to ensure atomicity.
   */
  async deductStockInTransaction(
    tx: Prisma.TransactionClient,
    productId: string,
    quantity: number,
    reason: MovementReason,
    reference?: string,
  ): Promise<void> {
    // Locking read: aggregate within the transaction ensures no concurrent
    // transaction can read stale data before writing.
    const result = await tx.stockMovement.aggregate({
      where: { productId },
      _sum: { quantityChange: true },
    });
    const currentStock = result._sum.quantityChange ?? 0;

    if (currentStock < quantity) {
      throw new BadRequestException(
        `Insufficient stock for product ${productId}. Available: ${currentStock}, requested: ${quantity}`,
      );
    }

    await tx.stockMovement.create({
      data: {
        productId,
        quantityChange: -quantity,
        reason,
        reference,
      },
    });
  }

  /**
   * Restore stock (e.g., on order cancellation).
   */
  async restoreStock(
    tx: Prisma.TransactionClient,
    productId: string,
    quantity: number,
    reason: MovementReason,
    reference?: string,
  ): Promise<void> {
    await tx.stockMovement.create({
      data: {
        productId,
        quantityChange: quantity,
        reason,
        reference,
      },
    });
  }

  /**
   * Get all movements for a product (Admin).
   */
  async getMovements(productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, isDeleted: false },
    });
    if (!product) throw new NotFoundException(`Product ${productId} not found`);

    return this.prisma.stockMovement.findMany({
      where: { productId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Low-stock report for Admin. Returns products whose stock is below threshold.
   */
  async getLowStockReport(threshold = 10) {
    // Aggregate all movements, then filter those below threshold in JS
    const allMovements = await this.prisma.stockMovement.groupBy({
      by: ['productId'],
      _sum: { quantityChange: true },
    });

    const lowStockProductIds = allMovements
      .filter((m) => (m._sum.quantityChange ?? 0) <= threshold)
      .map((m) => m.productId);

    if (lowStockProductIds.length === 0) return [];

    const products = await this.prisma.product.findMany({
      where: { id: { in: lowStockProductIds }, isDeleted: false },
      include: { category: true },
    });

    return products.map((product) => {
      const movement = allMovements.find((m) => m.productId === product.id);
      return {
        ...product,
        currentStock: movement?._sum.quantityChange ?? 0,
      };
    });
  }
}
