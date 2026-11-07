import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthGuard } from '../common/auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { Principal } from '../common/auth.types';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto, SwitchWorkspaceDto } from './auth.dto';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}
  @Post('register') async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) response: Response) { return this.setRefreshCookie(await this.auth.register(dto), response); }
  @Post('login') async login(@Body() dto: LoginDto, @Res({ passthrough: true }) response: Response) { return this.setRefreshCookie(await this.auth.login(dto), response); }
  @Get('me') @UseGuards(AuthGuard) @ApiBearerAuth() async me(@CurrentUser() user: Principal) { const workspaces = await this.auth.workspaces(user.sub); const workspace = workspaces.find(entry => entry.id === user.orgId); return { user: { id: user.sub, email: user.email, name: user.name }, workspace: { id: user.orgId, name: workspace?.name, role: user.role }, workspaces }; }
  @Post('refresh') async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) { return this.setRefreshCookie(await this.auth.rotate(this.readCookie(request, 'nexora_refresh')), response); }
  @Post('logout') async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) { await this.auth.revoke(this.readCookie(request, 'nexora_refresh')); response.clearCookie('nexora_refresh', { httpOnly: true, sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', secure: process.env.NODE_ENV === 'production', path: '/api/auth' }); return { loggedOut: true }; }
  @Post('switch-workspace') @UseGuards(AuthGuard) @ApiBearerAuth() async switch(@CurrentUser() user: Principal, @Body() dto: SwitchWorkspaceDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) { await this.auth.revoke(this.readCookie(request, 'nexora_refresh')); return this.setRefreshCookie(await this.auth.switchWorkspace(user.sub, dto.organizationId), response); }

  private setRefreshCookie<T extends { refreshToken: string }>(result: T, response: Response) {
    const { refreshToken, ...publicResult } = result;
    response.cookie('nexora_refresh', refreshToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', path: '/api/auth', maxAge: 30 * 86400000 });
    return publicResult;
  }

  private readCookie(request: Request, name: string) {
    const cookieHeader = request.headers.cookie ?? '';
    const item = cookieHeader.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`));
    return item ? decodeURIComponent(item.slice(name.length + 1)) : '';
  }
}
