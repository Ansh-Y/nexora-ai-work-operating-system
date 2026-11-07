import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { AuthRequest, Principal } from './auth.types';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private jwt: JwtService, private prisma: PrismaService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Sign in to continue');
    try {
      const payload = await this.jwt.verifyAsync<Principal>(header.slice(7));
      const membership = await this.prisma.membership.findUnique({
        where: { organizationId_userId: { organizationId: payload.orgId, userId: payload.sub } },
        include: { user: true },
      });
      if (!membership) throw new Error('Membership revoked');
      request.user = { sub: payload.sub, orgId: payload.orgId, role: membership.role, email: membership.user.email, name: membership.user.name };
      return true;
    } catch { throw new UnauthorizedException('Session expired or workspace access was removed'); }
  }
}
