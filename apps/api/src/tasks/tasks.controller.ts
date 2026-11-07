import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../common/auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { Principal } from '../common/auth.types';
import { TasksService } from './tasks.service';
import { CommentDto, CreateTaskDto, DependencyDto, UpdateTaskDto } from './tasks.dto';

@ApiTags('Tasks') @ApiBearerAuth() @UseGuards(AuthGuard)
@Controller()
export class TasksController {
  constructor(private service: TasksService) {}
  @Get('projects/:projectId/tasks') list(@CurrentUser() user: Principal, @Param('projectId') projectId: string) { return this.service.list(user, projectId); }
  @Post('projects/:projectId/tasks') create(@CurrentUser() user: Principal, @Param('projectId') projectId: string, @Body() dto: CreateTaskDto) { return this.service.create(user, projectId, dto); }
  @Patch('tasks/:id') update(@CurrentUser() user: Principal, @Param('id') id: string, @Body() dto: UpdateTaskDto) { return this.service.update(user, id, dto); }
  @Delete('tasks/:id') remove(@CurrentUser() user: Principal, @Param('id') id: string) { return this.service.remove(user, id); }
  @Post('tasks/:id/dependencies') dependency(@CurrentUser() user: Principal, @Param('id') id: string, @Body() dto: DependencyDto) { return this.service.addDependency(user, id, dto.blockedTaskId); }
  @Post('tasks/:id/comments') comment(@CurrentUser() user: Principal, @Param('id') id: string, @Body() dto: CommentDto) { return this.service.addComment(user, id, dto); }
  @Get('tasks/:id/comments') comments(@CurrentUser() user: Principal, @Param('id') id: string) { return this.service.comments(user, id); }
}
