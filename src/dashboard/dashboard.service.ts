import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { PaymentStatus } from '@prisma/client';

@Injectable()
export class DashboardService {
  constructor(
    private prisma: PrismaService,
    private inventoryService: InventoryService,
  ) {}

  async getOrdersSummary() {
    const counts = await this.prisma.order.groupBy({
      by: ['status'],
      _count: {
        id: true,
      },
    });

    return counts.map((item) => ({
      status: item.status,
      count: item._count.id,
    }));
  }

  async getRevenueSummary(from?: string, to?: string) {
    const whereClause: any = { status: PaymentStatus.SUCCEEDED };

    if (from || to) {
      whereClause.createdAt = {};
      if (from) whereClause.createdAt.gte = new Date(from);
      if (to) whereClause.createdAt.lte = new Date(to);
    }

    const result = await this.prisma.payment.aggregate({
      where: whereClause,
      _sum: {
        amount: true,
      },
    });

    return {
      totalRevenue: result._sum.amount || 0,
    };
  }

  async getLowStockProducts() {
    return this.prisma.$queryRaw`
      SELECT p.id, p.name, p.sku, p."lowStockThreshold", COALESCE(SUM(sm."quantityChange"), 0)::int as "currentStock"
      FROM "Product" p
      LEFT JOIN "StockMovement" sm ON p.id = sm."productId"
      WHERE p.active = true AND p."isDeleted" = false
      GROUP BY p.id
      HAVING COALESCE(SUM(sm."quantityChange"), 0) <= p."lowStockThreshold"
    `;
  }
}
