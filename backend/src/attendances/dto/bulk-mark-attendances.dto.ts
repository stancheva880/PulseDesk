import { Type } from 'class-transformer';
import { AttendanceStatus } from '@prisma/client';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class BulkMarkAttendanceItemDto {
  @IsString()
  traineeId!: string;

  @IsEnum(AttendanceStatus)
  status!: AttendanceStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class BulkMarkAttendancesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique((item: BulkMarkAttendanceItemDto) => item.traineeId)
  @ValidateNested({ each: true })
  @Type(() => BulkMarkAttendanceItemDto)
  items!: BulkMarkAttendanceItemDto[];
}
