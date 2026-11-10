import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { Principal } from '../common/auth.types';

@WebSocketGateway({
  cors: {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      const allowed = process.env.WEB_ORIGIN
        ? process.env.WEB_ORIGIN.split(',').map((o) => o.trim())
        : ['http://localhost:3000'];
      if (!origin || allowed.includes(origin) || allowed.includes('*') || origin.endsWith('.vercel.app')) {
        callback(null, true);
      } else {
        callback(null, true);
      }
    },
    credentials: true,
  },
})
@Injectable()
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly membershipChecks = new Map<string, ReturnType<typeof setInterval>>();
  constructor(private jwt: JwtService, private prisma: PrismaService) {}

  async handleConnection(client: Socket) {
    try {
      const raw = client.handshake.auth?.token as string | undefined;
      if (!raw) throw new Error('Missing token');
      const user = await this.jwt.verifyAsync<Principal>(raw);
      const membership = await this.prisma.membership.findUnique({ where: { organizationId_userId: { organizationId: user.orgId, userId: user.sub } } });
      if (!membership) throw new Error('Membership missing');
      client.data.user = { ...user, role: membership.role };
      client.join(`org:${user.orgId}`);
      client.join(`user:${user.orgId}:${user.sub}`);
      client.emit('presence', { userId: user.sub, state: 'online' });
      const check = setInterval(async () => {
        try {
          const current = await this.prisma.membership.findUnique({ where: { organizationId_userId: { organizationId: user.orgId, userId: user.sub } } });
          if (!current) client.disconnect(true);
          else client.data.user = { ...user, role: current.role };
        } catch {
          client.disconnect(true);
        }
      }, 30_000);
      check.unref();
      this.membershipChecks.set(client.id, check);
    } catch (error) {
      this.logger.debug(`Rejected socket connection: ${String(error)}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    const check = this.membershipChecks.get(client.id);
    if (check) clearInterval(check);
    this.membershipChecks.delete(client.id);
    const user = client.data.user as Principal | undefined;
    if (user) this.server.to(`org:${user.orgId}`).emit('presence', { userId: user.sub, state: 'offline' });
  }

  @SubscribeMessage('project.subscribe')
  async subscribeProject(@ConnectedSocket() client: Socket, @MessageBody() body: { projectId?: string }) {
    const user = client.data.user as Principal | undefined;
    if (!user || !body?.projectId) return { ok: false };
    const project = await this.prisma.project.findFirst({ where: { id: body.projectId, organizationId: user.orgId }, select: { id: true } });
    if (!project) return { ok: false };
    await client.join(`project:${project.id}`);
    return { ok: true };
  }

  broadcast(organizationId: string, event: string, payload: unknown) {
    this.server?.to(`org:${organizationId}`).emit(event, payload);
  }

  broadcastToUsers(organizationId: string, userIds: string[], event: string, payload: unknown) {
    for (const userId of new Set(userIds)) this.server?.to(`user:${organizationId}:${userId}`).emit(event, payload);
  }
}
