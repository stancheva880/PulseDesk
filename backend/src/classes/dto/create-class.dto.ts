import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { BillingMode, WaitlistMode } from '@prisma/client';
import { MAX_AMOUNT, MIN_AMOUNT } from '@/common/dto/money';

export class CreateClassDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsEnum(BillingMode)
  billingMode!: BillingMode;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(MIN_AMOUNT)
  @Max(MAX_AMOUNT)
  monthlyAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(MIN_AMOUNT)
  @Max(MAX_AMOUNT)
  sessionPrice?: number;

  /** TKT-0109: required together when billingMode is PER_COURSE, forbidden otherwise. */
  @IsOptional()
  @IsDateString()
  courseStart?: string;

  @IsOptional()
  @IsDateString()
  courseEnd?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(MIN_AMOUNT)
  @Max(MAX_AMOUNT)
  coursePrice?: number;

  /** TKT-0103: max trainees per session of this class; omitted = unlimited. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  capacity?: number;

  /** TKT-0112: what happens to a freed spot on a full session; omitted = NONE. */
  @IsOptional()
  @IsEnum(WaitlistMode)
  waitlistMode?: WaitlistMode;

  /** TKT-0117: customers may book/cancel/queue themselves; omitted = off. */
  @IsOptional()
  @IsBoolean()
  allowSelfBooking?: boolean;

  /** TKT-0117: minutes before start when self-service closes; requires allowSelfBooking. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  bookingCutoffMin?: number;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  locationIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  trainerIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  traineeIds?: string[];
}
