import { IsString, MinLength } from 'class-validator';

export class CreateWaitlistEntryDto {
  @IsString()
  @MinLength(1)
  traineeId!: string;
}
