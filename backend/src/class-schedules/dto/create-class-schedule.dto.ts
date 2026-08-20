import { DayOfWeek } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, Matches } from 'class-validator';

export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateClassScheduleDto {
  @IsString()
  classId!: string;

  @IsString()
  locationId!: string;

  @IsEnum(DayOfWeek)
  dayOfWeek!: DayOfWeek;

  @IsString()
  @Matches(HHMM, { message: 'startTime must be HH:MM (24-hour)' })
  startTime!: string;

  @IsString()
  @Matches(HHMM, { message: 'endTime must be HH:MM (24-hour)' })
  endTime!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
