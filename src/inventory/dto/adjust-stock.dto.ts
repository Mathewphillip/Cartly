import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MovementReason } from '@prisma/client';

export class AdjustStockDto {
  @ApiProperty({ description: 'Product ID to adjust' })
  @IsUUID()
  @IsNotEmpty()
  productId!: string;

  @ApiProperty({
    description: 'Quantity change — positive to add stock, negative to deduct',
    example: 50,
  })
  @IsInt()
  quantityChange!: number;

  @ApiProperty({
    enum: MovementReason,
    description: 'Reason for the stock movement',
    example: MovementReason.RESTOCK,
  })
  @IsEnum(MovementReason)
  reason!: MovementReason;

  @ApiPropertyOptional({ example: 'Manual restock from supplier' })
  @IsString()
  @IsOptional()
  reference?: string;
}
