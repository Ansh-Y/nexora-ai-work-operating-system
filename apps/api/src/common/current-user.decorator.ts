import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthRequest } from './auth.types';

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) =>
  (ctx.switchToHttp().getRequest<AuthRequest>()).user,
);
