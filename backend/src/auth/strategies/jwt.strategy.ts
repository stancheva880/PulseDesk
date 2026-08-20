import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import {
  JWT_AUDIENCE,
  JWT_ISSUER,
  type AccessJwtPayload,
  type AuthenticatedUser,
} from '../types/jwt-payload';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    const secret = config.get<string>('JWT_ACCESS_SECRET');
    if (!secret) throw new Error('JWT_ACCESS_SECRET is not set');
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
      // RFC 8725 3.1 — never infer the algorithm from the token. Without this pin
      // jsonwebtoken accepts the whole HS family for a string secret, so an
      // HS384-signed token would verify.
      algorithms: ['HS256'],
      // RFC 8725 3.8 / 3.9 — same constants as the signer, so sign and verify
      // cannot drift apart.
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
  }

  validate(payload: AccessJwtPayload): AuthenticatedUser {
    // Only access tokens authenticate. Refresh tokens are opaque today, so nothing
    // else is signed with this key — this keeps it true if a second signed token
    // kind is ever added (RFC 8725 3.11/3.12).
    if (payload.type !== 'access') throw new UnauthorizedException('Invalid token type');
    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      tenantId: payload.tenantId,
    };
  }
}
