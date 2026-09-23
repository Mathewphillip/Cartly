import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

/**
 * Redis-backed stock reservation service.
 *
 * Key design:
 *   reservation:<userId>:<productId>  → reserved quantity (string, TTL 15 min)
 *
 * Redis is NOT the source of truth for permanent inventory.
 * PostgreSQL remains authoritative. Reservations only prevent
 * other customers from over-committing during the shopping window.
 *
 * If Redis is unavailable the application degrades gracefully —
 * reservations are skipped, relying on the DB-level check at checkout.
 */
@Injectable()
export class ReservationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReservationService.name);
  private readonly TTL_SECONDS = 15 * 60; // 15 minutes
  private client!: Redis;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    this.client = new Redis({
      host: this.configService.get<string>('REDIS_HOST') || 'localhost',
      port: this.configService.get<number>('REDIS_PORT') || 6379,
      lazyConnect: true,
    });
    this.client.on('error', (err: Error) => {
      this.logger.warn(`Redis error (reservations degraded): ${err.message}`);
    });
  }

  async onModuleDestroy() {
    await this.client.quit();
  }

  private buildKey(userId: string, productId: string): string {
    return `reservation:${userId}:${productId}`;
  }

  /**
   * Set or update a reservation for userId + productId.
   * Resets the TTL each time (extending the window on activity).
   */
  async setReservation(userId: string, productId: string, quantity: number): Promise<void> {
    try {
      const key = this.buildKey(userId, productId);
      await this.client.set(key, quantity.toString(), 'EX', this.TTL_SECONDS);
    } catch (err) {
      this.logger.warn(`Failed to set reservation: ${err}`);
    }
  }

  /**
   * Get the currently reserved quantity for a user+product pair.
   * Returns 0 if no reservation exists or Redis is unavailable.
   */
  async getReservation(userId: string, productId: string): Promise<number> {
    try {
      const key = this.buildKey(userId, productId);
      const value = await this.client.get(key);
      return value ? parseInt(value, 10) : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Get all reservations across all users for a product.
   * Used by stock availability calculation.
   */
  async getTotalReservedForProduct(productId: string): Promise<number> {
    try {
      const pattern = `reservation:*:${productId}`;
      const keys = await this.client.keys(pattern);
      if (keys.length === 0) return 0;
      const values = await this.client.mget(...keys);
      return values.reduce((sum: number, v: string | null) => sum + (v ? parseInt(v, 10) : 0), 0);
    } catch {
      return 0;
    }
  }

  /**
   * Release the reservation for a specific user + product.
   */
  async releaseReservation(userId: string, productId: string): Promise<void> {
    try {
      const key = this.buildKey(userId, productId);
      await this.client.del(key);
    } catch (err) {
      this.logger.warn(`Failed to release reservation: ${err}`);
    }
  }

  /**
   * Release all reservations for a user (e.g., after checkout or cart clear).
   */
  async releaseAllForUser(userId: string): Promise<void> {
    try {
      const pattern = `reservation:${userId}:*`;
      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        await this.client.del(...keys);
      }
    } catch (err) {
      this.logger.warn(`Failed to release all reservations for user ${userId}: ${err}`);
    }
  }

  /**
   * Get all reservations for a user as a map of productId → quantity.
   */
  async getAllReservationsForUser(userId: string): Promise<Record<string, number>> {
    try {
      const pattern = `reservation:${userId}:*`;
      const keys = await this.client.keys(pattern);
      if (keys.length === 0) return {};
      const values = await this.client.mget(...keys);
      const result: Record<string, number> = {};
      keys.forEach((key: string, i: number) => {
        const productId = key.split(':')[2];
        result[productId] = values[i] ? parseInt(values[i]!, 10) : 0;
      });
      return result;
    } catch {
      return {};
    }
  }
}
