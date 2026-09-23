import { Test, TestingModule } from '@nestjs/testing';
import { CartService } from './cart.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { ReservationService } from './reservation.service.js';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { vi, expect, describe, it, beforeEach } from 'vitest';

describe('CartService', () => {
  let service: CartService;
  let prisma: PrismaService;
  let inventory: InventoryService;
  let reservation: ReservationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CartService,
        {
          provide: PrismaService,
          useValue: {
            cart: { findUnique: vi.fn(), create: vi.fn() },
            cartItem: { upsert: vi.fn() },
            product: { findFirst: vi.fn() },
          },
        },
        {
          provide: InventoryService,
          useValue: { getStock: vi.fn() },
        },
        {
          provide: ReservationService,
          useValue: {
            getTotalReservedForProduct: vi.fn(),
            getReservation: vi.fn(),
            setReservation: vi.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<CartService>(CartService);
    prisma = module.get<PrismaService>(PrismaService);
    inventory = module.get<InventoryService>(InventoryService);
    reservation = module.get<ReservationService>(ReservationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('addItem', () => {
    it('should throw BadRequestException if stock is insufficient due to reservations', async () => {
      vi.spyOn(prisma.product, 'findFirst').mockResolvedValue({ id: 'p1', active: true, isDeleted: false } as any);
      vi.spyOn(inventory, 'getStock').mockResolvedValue(10);
      // 8 reserved by others
      vi.spyOn(reservation, 'getTotalReservedForProduct').mockResolvedValue(8);
      vi.spyOn(reservation, 'getReservation').mockResolvedValue(0);

      await expect(
        service.addItem('user-1', { productId: 'p1', quantity: 5 })
      ).rejects.toThrow(BadRequestException);
    });

    it('should add item successfully if stock is available', async () => {
      const mockCart = { id: 'c1', items: [] };
      vi.spyOn(prisma.product, 'findFirst').mockResolvedValue({ id: 'p1', active: true, isDeleted: false, price: { mul: vi.fn() } } as any);
      vi.spyOn(inventory, 'getStock').mockResolvedValue(10);
      vi.spyOn(reservation, 'getTotalReservedForProduct').mockResolvedValue(2);
      vi.spyOn(reservation, 'getReservation').mockResolvedValue(0);
      vi.spyOn(prisma.cart, 'findUnique').mockResolvedValue(mockCart as any);
      vi.spyOn(prisma.cartItem, 'upsert').mockResolvedValue({} as any);

      // We skip actual return validation to keep test simple, just verify it resolves
      vi.spyOn(service as any, 'getCart').mockResolvedValue({ subtotal: 0, items: [] });

      await expect(
        service.addItem('user-1', { productId: 'p1', quantity: 5 })
      ).resolves.toBeDefined();
      
      expect(reservation.setReservation).toHaveBeenCalledWith('user-1', 'p1', 5);
    });
  });
});
