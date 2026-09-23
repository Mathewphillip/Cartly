import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { Role } from '@prisma/client';

@Controller('api/v1/admin/dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('orders-summary')
  async getOrdersSummary() {
    return this.dashboardService.getOrdersSummary();
  }

  @Get('revenue-summary')
  async getRevenueSummary(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.dashboardService.getRevenueSummary(from, to);
  }

  @Get('low-stock')
  async getLowStockProducts() {
    return this.dashboardService.getLowStockProducts();
  }
}
