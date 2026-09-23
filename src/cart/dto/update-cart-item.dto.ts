import { IsInt, IsNotEmpty, IsUUID, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateCartItemDto {
  @ApiProperty({ description: 'Product ID to update' })
  @IsUUID()
  @IsNotEmpty()
  productId!: string;

  @ApiProperty({ description: 'New quantity (set to 0 to remove)', example: 2, minimum: 0 })
  @IsInt()
  @Min(0)
  quantity!: number;
}
