import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { MAX_AMOUNT } from '@/common/dto/money';

export class CreateCardDto {
  @IsString()
  traineeId!: string;

  // Omitted = tenant-wide card (visits usable for any class).
  @IsOptional()
  @IsString()
  classId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  totalVisits!: number;

  // 0 allowed — a free card's purchase fee is created with amount 0.
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_AMOUNT)
  price!: number;

  // Omitted = never expires.
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
