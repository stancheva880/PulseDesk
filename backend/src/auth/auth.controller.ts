import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService, parseDurationSeconds, type LoginMembership } from './auth.service';
import {
  REFRESH_COOKIE,
  clearRefreshCookieOptions,
  readRefreshCookie,
  refreshCookieOptions,
} from './cookies';
import { NoContent, ResponseSchema } from '@/common/response-schema';
import {
  ForgotPasswordResponseSchema,
  LoginResponseSchema,
  RefreshResponseSchema,
} from './auth.schema';
import { Public } from './decorators/public.decorator';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import type { TokenPair } from './types/jwt-payload';

// Browsers authenticate the refresh with an httpOnly cookie and never see the token.
// Non-browser callers still pass it in the body. The response mirrors whichever the
// request used, so one endpoint serves both without a mode flag.
type AccessOnly = { accessToken: string };

@Public()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  private isProd(): boolean {
    return (this.config.get<string>('NODE_ENV') ?? '').toLowerCase() === 'production';
  }

  private setRefreshCookie(res: Response, refreshToken: string): void {
    const ttl = this.config.get<string>('JWT_REFRESH_TTL') ?? '7d';
    res.cookie(
      REFRESH_COOKIE,
      refreshToken,
      refreshCookieOptions(parseDurationSeconds(ttl) * 1000, this.isProd()),
    );
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema('LoginResponse', LoginResponseSchema)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccessOnly & { memberships: LoginMembership[] }> {
    const user = await this.auth.validateUser(dto.email, dto.password);
    if (!user) throw new UnauthorizedException('Invalid credentials');
    const tokens = await this.auth.login(user);
    // The client picks its active tenant from this list (picker when > 1).
    const memberships = (user.memberships ?? []).map((m) => ({
      tenantId: m.tenantId,
      tenantName: m.tenant.name,
      role: m.role,
    }));
    this.setRefreshCookie(res, tokens.refreshToken);
    // refreshToken is deliberately absent from the body — that is the whole point.
    return { accessToken: tokens.accessToken, memberships };
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema('RefreshResponse', RefreshResponseSchema)
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccessOnly | TokenPair> {
    const fromCookie = readRefreshCookie(req.headers.cookie);
    const presented = fromCookie ?? dto.refreshToken;
    // 401 rather than 400: to a caller, "no token" and "bad token" are the same answer,
    // and a 400 would tell an attacker their probe was malformed rather than rejected.
    if (!presented) throw new UnauthorizedException('Invalid refresh token');

    const tokens = await this.auth.refresh(presented);
    if (fromCookie) {
      this.setRefreshCookie(res, tokens.refreshToken);
      return { accessToken: tokens.accessToken };
    }
    // Body-authenticated caller (no browser cookie jar) — hand the rotation back.
    return tokens;
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ResponseSchema('LogoutNoContent', NoContent)
  async logout(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const presented = readRefreshCookie(req.headers.cookie) ?? dto.refreshToken;
    // Unknown or absent tokens still clear the cookie and return 204 — logout must not
    // report whether the token existed.
    if (presented) await this.auth.logout(presented);
    res.clearCookie(REFRESH_COOKIE, clearRefreshCookieOptions(this.isProd()));
  }

  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema('ForgotPasswordResponse', ForgotPasswordResponseSchema)
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<{ message: string }> {
    await this.auth.requestPasswordReset(dto.email);
    return {
      message: 'If an account exists for that email, you will receive instructions shortly.',
    };
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ResponseSchema('ResetPasswordNoContent', NoContent)
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    await this.auth.completePasswordReset(dto.token, dto.newPassword);
  }
}
