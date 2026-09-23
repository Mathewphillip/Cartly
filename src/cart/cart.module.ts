import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { CartController } from './cart.controller.js';
import { CartService } from './cart.service.js';
import { ReservationService } from './reservation.service.js';

@Module({
  imports: [AuthModule, InventoryModule],
  controllers: [CartController],
  providers: [CartService, ReservationService],
  exports: [CartService, ReservationService],
})
export class CartModule {}
