import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

// The slug is asked for, not derived from the name: deriving needs a collision rule, and a
// duplicate already answers 409 from the unique constraint.
//
// Written without a nested quantifier — the tidier `^[a-z0-9]+(-[a-z0-9]+)*$` is what
// security/detect-unsafe-regex flags. The cost is that `a--b` passes; a double hyphen in a slug
// is harmless, and MinLength/MaxLength bound the input either way.
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

export class CreateTenantDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(60)
  @Matches(SLUG_PATTERN, {
    message: 'slug must be lowercase letters, digits and single hyphens',
  })
  slug!: string;

  // A club with no venue cannot hold a class, and an ADMIN with no location reads empty lists
  // (TKT-0054), so onboarding creates the first location in the same step.
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  locationName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  locationAddress?: string;

  // TKT-0062: no password is accepted here. The administrator is invited and sets their own,
  // so nobody but them ever knows it. forbidNonWhitelisted turns a payload still carrying
  // adminPassword into a 400 by this field's absence alone.
  // TKT-0133: optional — a club can be onboarded with no administrator yet and one assigned
  // later from Users. Omitted entirely skips the admin step (see tenants.service.ts's create()).
  @IsOptional()
  @IsEmail()
  adminEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  adminFirstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  adminLastName?: string;
}
