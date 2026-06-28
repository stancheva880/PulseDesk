import {
  ArrayUnique,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateSessionDto {
  @IsString()
  classId!: string;

  @IsString()
  locationId!: string;

  @IsDateString()
  startsAt!: string;

  @IsDateString()
  endsAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  // Optional override — if omitted, defaults to the class's trainer roster at creation time.
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  trainerIds?: string[];
}
