import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service.js';
import { OrdersController } from './orders.controller.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { CartModule } from '../cart/cart.module.js';
import { CouponsModule } from '../coupons/coupons.module.js';

@Module({
  imports: [InventoryModule, CartModule, CouponsModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
