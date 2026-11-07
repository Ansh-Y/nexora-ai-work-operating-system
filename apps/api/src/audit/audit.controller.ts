import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../common/auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { Principal } from '../common/auth.types';
import { PrismaService } from '../prisma/prisma.service';

@Controller('audit')
@UseGuards(AuthGuard)
export class AuditController {
  constructor(private prisma: PrismaService) {}
  @Get()
  list(@CurrentUser() user: Principal, @Query('take') take?: string) {
    return this.prisma.auditEvent.findMany({ where: { organizationId: user.orgId }, include: { actor: { select: { name: true, email: true } } }, orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(Number(take) || 50, 1), 100) });
  }
}
