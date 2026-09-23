import {
  Controller, Get, Post, Param, Body, UseGuards, Query,
} from '@nestjs/common';
import { InventoryService } from './inventory.service.js';
import { AdjustStockDto } from './dto/adjust-stock.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { Role } from '@prisma/client';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';

@ApiTags('inventory')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get('low-stock')
  @ApiOperation({ summary: 'Get low-stock products (Admin only)' })
  @ApiQuery({ name: 'threshold', required: false, type: Number, description: 'Stock threshold (default: 10)' })
  getLowStock(@Query('threshold') threshold?: string) {
    return this.inventoryService.getLowStockReport(threshold ? parseInt(threshold, 10) : 10);
  }

  @Get(':productId')
  @ApiOperation({ summary: 'Get current stock for a product (Admin only)' })
  async getStock(@Param('productId') productId: string) {
    const stock = await this.inventoryService.getStock(productId);
    return { productId, stock };
  }

  @Get(':productId/movements')
  @ApiOperation({ summary: 'Get stock movement history for a product (Admin only)' })
  getMovements(@Param('productId') productId: string) {
    return this.inventoryService.getMovements(productId);
  }

  @Post('adjust')
  @ApiOperation({ summary: 'Manually adjust stock for a product (Admin only)' })
  adjust(@Body() dto: AdjustStockDto) {
    return this.inventoryService.adjustStock(dto);
  }
}
