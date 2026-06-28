import { IsDateString, IsOptional, IsString } from 'class-validator';

export class GenerateSessionFeesDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;

  @IsOptional()
  @IsString()
  classId?: string;
}
