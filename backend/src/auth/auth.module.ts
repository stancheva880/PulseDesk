import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MembershipsController } from './memberships.controller';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { TenantContextGuard } from './guards/tenant-context.guard';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    ConfigModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    // No module-level secret or signOptions: auth.service passes secret, expiresIn,
    // algorithm, issuer and audience explicitly on every call, so defaults here
    // would only mislead the next reader.
    JwtModule.register({}),
  ],
  controllers: [AuthController, MembershipsController],
  providers: [
    AuthService,
    JwtStrategy,
    // Order matters: TenantContextGuard swaps the request role to the active
    // membership's role, so it must run before RolesGuard.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantContextGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
