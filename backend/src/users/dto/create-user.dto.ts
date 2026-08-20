import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { UserRole } from '@prisma/client';

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  lastName?: string;

  // Free text, deliberately unvalidated beyond the length — same as Trainee and ContactPerson.
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsEnum(UserRole)
  role!: UserRole;

  // Required for ADMIN/EMPLOYEE/CUSTOMER roles when creator enforces location scoping.
  // For ADMIN-the-creator, all entries must lie within the creator's assigned locations.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayUnique()
  locationIds?: string[];
}
