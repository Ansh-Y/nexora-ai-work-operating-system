import { Body, Controller, Delete, Get, Param, ParseBoolPipe, ParseUUIDPipe, Patch, Post, Query, Res, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthGuard } from '../common/auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { Principal } from '../common/auth.types';
import { CreateMeetingDto, ConvertMeetingActionDto, UpdateMeetingActionDto, UpdateMeetingDto } from './meetings.dto';
import { MeetingsService } from './meetings.service';
import { MeetingUploadFile } from './meeting-audio-storage.service';

const configuredLimit = Number(process.env.MEETING_MAX_UPLOAD_BYTES);
const uploadLimit = Number.isSafeInteger(configuredLimit) && configuredLimit > 0 ? Math.min(configuredLimit, 100 * 1024 * 1024) : 25 * 1024 * 1024;

@ApiTags('Meetings') @ApiBearerAuth() @Controller('meetings') @UseGuards(AuthGuard)
export class MeetingsController {
  constructor(private service: MeetingsService) {}

  @Get() list(@CurrentUser() user: Principal, @Query('q') query = '', @Query('archived', new ParseBoolPipe({ optional: true })) archived = false) {
    return this.service.list(user, query, archived);
  }

  @Post() create(@CurrentUser() user: Principal, @Body() dto: CreateMeetingDto) { return this.service.create(user, dto); }
  @Get(':id') get(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) { return this.service.get(user, id); }
  @Patch(':id') update(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMeetingDto) { return this.service.update(user, id, dto); }
  @Delete(':id') archive(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) { return this.service.archive(user, id); }

  @Post(':id/recordings')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: uploadLimit, files: 1 } }))
  uploadRecording(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: MeetingUploadFile) {
    return this.service.uploadRecording(user, id, file);
  }

  @Get(':id/recordings/:recordingId/audio')
  async recording(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string, @Param('recordingId', ParseUUIDPipe) recordingId: string, @Res({ passthrough: true }) response: Response) {
    const result = await this.service.recordingStream(user, id, recordingId);
    response.setHeader('Content-Type', result.mimeType);
    response.setHeader('Content-Disposition', `attachment; filename="meeting-recording.${result.mimeType === 'audio/wav' ? 'wav' : result.mimeType === 'audio/mp4' ? 'm4a' : 'mp3'}"`);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(result.stream);
  }

  @Post(':id/recordings/:recordingId/retry')
  retry(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string, @Param('recordingId', ParseUUIDPipe) recordingId: string) {
    return this.service.retryProcessing(user, id, recordingId);
  }

  @Patch(':id/actions/:actionId')
  updateAction(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string, @Param('actionId', ParseUUIDPipe) actionId: string, @Body() dto: UpdateMeetingActionDto) {
    return this.service.updateAction(user, id, actionId, dto);
  }

  @Post(':id/actions/:actionId/approve')
  approveAction(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string, @Param('actionId', ParseUUIDPipe) actionId: string) {
    return this.service.approveAction(user, id, actionId);
  }

  @Post(':id/actions/:actionId/reject')
  rejectAction(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string, @Param('actionId', ParseUUIDPipe) actionId: string) {
    return this.service.rejectAction(user, id, actionId);
  }

  @Post(':id/actions/:actionId/convert')
  convertAction(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string, @Param('actionId', ParseUUIDPipe) actionId: string, @Body() dto: ConvertMeetingActionDto) {
    return this.service.convertAction(user, id, actionId, dto);
  }
}
