import { IsString } from 'class-validator';

export class AddAttendanceDto {
  @IsString()
  traineeId!: string;
}
