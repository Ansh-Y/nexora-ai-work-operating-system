import { OrganizationRole } from '@prisma/client';
import { Request } from 'express';

export interface Principal {
  sub: string;
  orgId: string;
  role: OrganizationRole;
  email: string;
  name: string;
}

export interface AuthRequest extends Request {
  user: Principal;
  headers: Request['headers'] & { 'x-request-id'?: string };
}
