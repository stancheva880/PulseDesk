import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ResponseSchemaInterceptor } from './common/response-schema.interceptor';
import { AttendancesModule } from './attendances/attendances.module';
import { AuthModule } from './auth/auth.module';
import { CardsModule } from './cards/cards.module';
import { LocationScopeModule } from './auth/scope/location-scope.module';
import { ClassSchedulesModule } from './class-schedules/class-schedules.module';
import { ClassesModule } from './classes/classes.module';
import { ContactsModule } from './contacts/contacts.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { FeesModule } from './fees/fees.module';
import { HealthController } from './health/health.controller';
import { LocationsModule } from './locations/locations.module';
import { MailModule } from './mail/mail.module';
import { PaymentsModule } from './payments/payments.module';
import { PrismaModule } from './prisma/prisma.module';
import { RefundsModule } from './refunds/refunds.module';
import { WaitlistsModule } from './waitlists/waitlists.module';
import { SessionsModule } from './sessions/sessions.module';
import { TenantsModule } from './tenants/tenants.module';
import { TraineesModule } from './trainees/trainees.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
    }),
    // ponytail: in-memory per-IP buckets, so one process only — N replicas multiply the
    // effective limit and a restart resets every counter. Swap in Redis storage at >1
    // instance. Seeing the real client IP behind a proxy needs TRUST_PROXY_HOPS (app-setup.ts).
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    MailModule,
    AuthModule,
    LocationScopeModule,
    UsersModule,
    LocationsModule,
    ClassesModule,
    TraineesModule,
    ContactsModule,
    SessionsModule,
    ClassSchedulesModule,
    AttendancesModule,
    FeesModule,
    PaymentsModule,
    RefundsModule,
    WaitlistsModule,
    CardsModule,
    DashboardModule,
    TenantsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Registered once, globally: handlers without @ResponseSchema pass straight through.
    { provide: APP_INTERCEPTOR, useClass: ResponseSchemaInterceptor },
  ],
})
export class AppModule {}
