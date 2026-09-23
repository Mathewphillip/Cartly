import { Controller, Post, Get, Body, Param, UseGuards, Put } from '@nestjs/common';
import { OrdersService } from './orders.service.js';
import { CreateOrderDto } from './dto/create-order.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Role, OrderStatus } from '@prisma/client';
import type { User } from '@prisma/client';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody } from '@nestjs/swagger';

@ApiTags('orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post('checkout')
  @ApiOperation({ summary: 'Checkout current cart and create order' })
  checkout(@CurrentUser() user: User, @Body() dto: CreateOrderDto) {
    return this.ordersService.checkout(user.id, dto.couponCode);
  }

  @Get('my-orders')
  @ApiOperation({ summary: 'Get current user orders' })
  findMyOrders(@CurrentUser() user: User) {
    return this.ordersService.findMyOrders(user.id);
  }

  @Get('my-orders/:id')
  @ApiOperation({ summary: 'Get a specific order for current user' })
  findOne(@CurrentUser() user: User, @Param('id') id: string) {
    return this.ordersService.findOrderById(user.id, id);
  }

  // Admin Routes
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @Get()
  @ApiOperation({ summary: 'Get all orders (Admin only)' })
  findAll() {
    return this.ordersService.findAllOrders();
  }

  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @Put(':id/status')
  @ApiOperation({ summary: 'Update order status (Admin only)' })
  @ApiBody({ schema: { properties: { status: { type: 'string', example: 'SHIPPED' } } } })
  updateStatus(@Param('id') id: string, @Body('status') status: OrderStatus) {
    return this.ordersService.updateOrderStatus(id, status);
  }
}
