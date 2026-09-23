import { Injectable, NotFoundException, ConflictException, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { CreateProductDto } from './dto/create-product.dto.js';
import { UpdateProductDto } from './dto/update-product.dto.js';
import { QueryProductDto } from './dto/query-product.dto.js';
import { Prisma } from '@prisma/client';

@Injectable()
export class ProductsService {
  constructor(
    private prisma: PrismaService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async findAll(query: QueryProductDto) {
    const {
      search, categoryId, minPrice, maxPrice, active,
      page = 1, limit = 20, sortBy = 'createdAt', sortOrder = 'desc',
    } = query;

    const where: Prisma.ProductWhereInput = {
      isDeleted: false,
      ...(active !== undefined && { active: active === 'true' }),
      ...(categoryId && { categoryId }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
          { sku: { contains: search, mode: 'insensitive' } },
        ],
      }),
      ...((minPrice || maxPrice) && {
        price: {
          ...(minPrice && { gte: new Prisma.Decimal(minPrice) }),
          ...(maxPrice && { lte: new Prisma.Decimal(maxPrice) }),
        },
      }),
    };

    const skip = (page - 1) * limit;

    const [total, items] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        include: { category: true },
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: limit,
      }),
    ]);

    return {
      data: items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, isDeleted: false },
      include: { category: true },
    });
    if (!product) throw new NotFoundException(`Product ${id} not found`);
    return product;
  }

  async findBySlug(slug: string) {
    const product = await this.prisma.product.findFirst({
      where: { slug, isDeleted: false },
      include: { category: true },
    });
    if (!product) throw new NotFoundException(`Product with slug '${slug}' not found`);
    return product;
  }

  async create(dto: CreateProductDto) {
    const [bySlug, bySku] = await Promise.all([
      this.prisma.product.findFirst({ where: { slug: dto.slug } }),
      this.prisma.product.findFirst({ where: { sku: dto.sku } }),
    ]);
    if (bySlug) throw new ConflictException('Slug already in use');
    if (bySku) throw new ConflictException('SKU already in use');

    return this.prisma.product.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        description: dto.description,
        sku: dto.sku,
        price: new Prisma.Decimal(dto.price),
        categoryId: dto.categoryId,
      },
      include: { category: true },
    });
  }

  async update(id: string, dto: UpdateProductDto) {
    await this.findOne(id);

    if (dto.slug) {
      const existing = await this.prisma.product.findFirst({ where: { slug: dto.slug } });
      if (existing && existing.id !== id) throw new ConflictException('Slug already in use');
    }
    if (dto.sku) {
      const existing = await this.prisma.product.findFirst({ where: { sku: dto.sku } });
      if (existing && existing.id !== id) throw new ConflictException('SKU already in use');
    }

    const updated = await this.prisma.product.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.slug && { slug: dto.slug }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.sku && { sku: dto.sku }),
        ...(dto.price && { price: new Prisma.Decimal(dto.price) }),
        ...(dto.categoryId && { categoryId: dto.categoryId }),
      },
      include: { category: true },
    });
    
    // Targeted exact invalidation.
    // List/Search responses will naturally expire after their 60s TTL.
    await this.cacheManager.del(`/api/v1/products/${id}`);
    
    return updated;
  }

  async softDelete(id: string) {
    await this.findOne(id);
    const updated = await this.prisma.product.update({
      where: { id },
      data: { isDeleted: true, active: false },
    });
    await this.cacheManager.del(`/api/v1/products/${id}`);
    return updated;
  }

  async restore(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException(`Product ${id} not found`);
    const updated = await this.prisma.product.update({
      where: { id },
      data: { isDeleted: false, active: true },
    });
    await this.cacheManager.del(`/api/v1/products/${id}`);
    return updated;
  }
}
