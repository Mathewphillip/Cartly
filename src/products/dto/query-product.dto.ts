import { IsOptional, IsString, IsNumberString, IsIn, IsUUID, IsBooleanString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class QueryProductDto {
  @ApiPropertyOptional({ example: 'laptop', description: 'Search by name or description' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by category ID' })
  @IsUUID()
  @IsOptional()
  categoryId?: string;

  @ApiPropertyOptional({ example: '100', description: 'Minimum price' })
  @IsNumberString()
  @IsOptional()
  minPrice?: string;

  @ApiPropertyOptional({ example: '2000', description: 'Maximum price' })
  @IsNumberString()
  @IsOptional()
  maxPrice?: string;

  @ApiPropertyOptional({ example: 'true', description: 'Filter by active status' })
  @IsBooleanString()
  @IsOptional()
  active?: string;

  @ApiPropertyOptional({ example: 1, description: 'Page number', default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, description: 'Items per page', default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number = 20;

  @ApiPropertyOptional({ example: 'name', enum: ['name', 'price', 'createdAt'], description: 'Sort field' })
  @IsString()
  @IsIn(['name', 'price', 'createdAt'])
  @IsOptional()
  sortBy?: 'name' | 'price' | 'createdAt' = 'createdAt';

  @ApiPropertyOptional({ example: 'asc', enum: ['asc', 'desc'], description: 'Sort direction' })
  @IsIn(['asc', 'desc'])
  @IsOptional()
  sortOrder?: 'asc' | 'desc' = 'desc';
}
