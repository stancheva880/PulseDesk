import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { UserRole } from '@prisma/client';

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  lastName?: string;

  @IsEnum(UserRole)
  role!: UserRole;

  // SUPER_ADMIN-only field, ignored otherwise. When creating a SUPER_ADMIN, tenantId
  // must be omitted (server enforces). When creating a tenant user as SUPER_ADMIN,
  // the value comes from the X-Tenant-Id header — this DTO field is a redundant
  // hint accepted for backward-compat scripts but is not required.
  @IsOptional()
  @IsString()
  tenantId?: string;

  // Required for ADMIN/EMPLOYEE/CUSTOMER roles when creator enforces location scoping.
  // For ADMIN-the-creator, all entries must lie within the creator's assigned locations.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayUnique()
  locationIds?: string[];
}
