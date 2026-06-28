import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AttendancesModule } from './attendances/attendances.module';
import { AuthModule } from './auth/auth.module';
import { LocationScopeModule } from './auth/scope/location-scope.module';
import { ClassSchedulesModule } from './class-schedules/class-schedules.module';
import { ClassesModule } from './classes/classes.module';
import { ContactsModule } from './contacts/contacts.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { FeesModule } from './fees/fees.module';
import { HealthModule } from './health/health.module';
import { LocationsModule } from './locations/locations.module';
import { MailModule } from './mail/mail.module';
import { PaymentsModule } from './payments/payments.module';
import { PrismaModule } from './prisma/prisma.module';
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
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 100 },
    ]),
    PrismaModule,
    MailModule,
    AuthModule,
    LocationScopeModule,
    HealthModule,
    TenantsModule,
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
    DashboardModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
