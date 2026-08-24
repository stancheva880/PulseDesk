import { IsString, MinLength } from 'class-validator';

export class ClaimWaitlistDto {
  @IsString()
  @MinLength(1)
  token!: string;
}
