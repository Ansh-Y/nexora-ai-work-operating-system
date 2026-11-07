import { Injectable } from '@nestjs/common';
import { ActorType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}
  append(event: { organizationId: string; actorType: ActorType; actorId?: string; action: string; targetType: string; targetId?: string; metadata?: Record<string, unknown>; requestId?: string }) {
    return this.prisma.auditEvent.create({ data: { ...event, metadata: (event.metadata ?? {}) as any } });
  }
}
