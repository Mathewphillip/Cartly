import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCategoryDto {
  @ApiProperty({ example: 'Electronics' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ example: 'electronics' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  slug!: string;

  @ApiPropertyOptional({ example: 'Gadgets and electronic devices' })
  @IsString()
  @IsOptional()
  description?: string;
}
