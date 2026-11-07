import { Module } from '@nestjs/common';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard } from '../common/auth.guard';

@Module({ imports: [JwtModule.registerAsync({ useFactory: (config: ConfigService) => ({ secret: config.getOrThrow<string>('JWT_SECRET'), signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN', '15m') as NonNullable<JwtModuleOptions['signOptions']>['expiresIn'] } }), inject: [ConfigService] })], controllers: [AuthController], providers: [AuthService, AuthGuard], exports: [JwtModule, AuthGuard] })
export class AuthModule {}
