import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

// currentPassword is required only when email is present — enforced in the service, not here,
// since class-validator has no clean "required if another field is set" rule. Password itself
// has its own endpoint (PATCH /users/me/password); this one never touches passwordHash.
export class UpdateOwnProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  firstName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  lastName?: string | null;

  // Free text, deliberately unvalidated beyond the length — same as CreateUserDto.
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string | null;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  currentPassword?: string;
}
