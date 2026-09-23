import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateOrderDto {
  @ApiPropertyOptional({ description: 'Optional coupon code to apply' })
  @IsString()
  @IsOptional()
  couponCode?: string;
}
