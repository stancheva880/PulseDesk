import { AttendanceRsvp } from '@prisma/client';
import { IsEnum, IsString } from 'class-validator';

export class RsvpDto {
  @IsString()
  traineeId!: string;

  @IsEnum(AttendanceRsvp)
  traineeRsvp!: AttendanceRsvp;
}
