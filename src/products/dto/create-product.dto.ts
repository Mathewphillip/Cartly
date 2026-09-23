import { IsNotEmpty, IsString, IsOptional, IsDecimal, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateProductDto {
  @ApiProperty({ example: 'Pro Laptop 15"' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiProperty({ example: 'pro-laptop-15' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(250)
  slug!: string;

  @ApiPropertyOptional({ example: 'High performance laptop' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ example: 'TECH-LAPTOP-01' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  sku!: string;

  @ApiProperty({ example: '1299.99' })
  @IsDecimal({ decimal_digits: '0,2' })
  price!: string;

  @ApiProperty({ example: 'uuid-of-category' })
  @IsUUID()
  @IsNotEmpty()
  categoryId!: string;
}
