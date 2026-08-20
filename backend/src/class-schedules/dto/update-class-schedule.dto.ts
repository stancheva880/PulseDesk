import { DayOfWeek } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, Matches } from 'class-validator';
import { HHMM } from './create-class-schedule.dto';

export class UpdateClassScheduleDto {
  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsEnum(DayOfWeek)
  dayOfWeek?: DayOfWeek;

  @IsOptional()
  @IsString()
  @Matches(HHMM, { message: 'startTime must be HH:MM (24-hour)' })
  startTime?: string;

  @IsOptional()
  @IsString()
  @Matches(HHMM, { message: 'endTime must be HH:MM (24-hour)' })
  endTime?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
