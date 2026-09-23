import { IsNotEmpty, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreatePaymentIntentDto {
  @ApiProperty({ description: 'Order ID to pay for' })
  @IsUUID()
  @IsNotEmpty()
  orderId!: string;
}
