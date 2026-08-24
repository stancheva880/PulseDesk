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
  ValidateIf,
} from 'class-validator';
import { BillingMode, WaitlistMode } from '@prisma/client';
import { MAX_AMOUNT, MIN_AMOUNT } from '@/common/dto/money';

// billingMode is editable since TKT-0109 (PRD-0015 supersedes the PRD-0003 immutability
// rule): a switch must satisfy the new mode's field rules, and the service clears the old
// mode's price columns — see ClassesService.update.
export class UpdateClassDto {
  @IsOptional()
  @IsEnum(BillingMode)
  billingMode?: BillingMode;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

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

  /** TKT-0109: valid only when the (effective) billingMode is PER_COURSE. */
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

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** TKT-0103: max trainees per session; `null` clears the limit (unlimited). */
  @IsOptional()
  @ValidateIf((o: UpdateClassDto) => o.capacity !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  capacity?: number | null;

  /** TKT-0112: switching to NONE stops new queue joins; existing entries stay. */
  @IsOptional()
  @IsEnum(WaitlistMode)
  waitlistMode?: WaitlistMode;

  /** TKT-0117: turning the flag off also clears bookingCutoffMin — see ClassesService.update. */
  @IsOptional()
  @IsBoolean()
  allowSelfBooking?: boolean;

  /** TKT-0117: minutes before start; `null` clears (open until start). Requires the flag on. */
  @IsOptional()
  @ValidateIf((o: UpdateClassDto) => o.bookingCutoffMin !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  bookingCutoffMin?: number | null;

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
