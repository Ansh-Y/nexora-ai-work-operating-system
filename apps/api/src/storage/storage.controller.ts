import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthGuard } from '../common/auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { Principal } from '../common/auth.types';
import { StorageService } from './storage.service';
import { LocalStorageProvider } from './local-storage.provider';
import {
  CreateRetentionHoldDto,
  ListStorageFilesQueryDto,
  ReleaseRetentionHoldDto,
  UpdateRetentionPolicyDto,
} from './storage.dto';
import { UploadFilePayload } from './storage.types';

type RawBodyRequest = Request & { rawBody?: Buffer };

@ApiTags('Storage')
@Controller('storage')
export class StorageController {
  constructor(
    private service: StorageService,
    private localProvider: LocalStorageProvider,
  ) {}

  @Get('summary')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  summary(@CurrentUser() user: Principal) {
    return this.service.getSummary(user);
  }

  @Get('files')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  listFiles(@CurrentUser() user: Principal, @Query() query: ListStorageFilesQueryDto) {
    return this.service.listFiles(user, query);
  }

  @Post('documents')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' }, projectId: { type: 'string', format: 'uuid' } }, required: ['file'] } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024, files: 1 } }))
  uploadDocument(
    @CurrentUser() user: Principal,
    @UploadedFile() file: UploadFilePayload,
    @Body('projectId') projectId?: string,
  ) {
    return this.service.uploadDocument(user, file, projectId);
  }

  @Get('files/:id/download-url')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  getDownloadUrl(
    @CurrentUser() user: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('expiresIn') expiresIn?: string,
  ) {
    const exp = expiresIn ? Number(expiresIn) : 900;
    return this.service.getDownloadUrl(user, id, Number.isFinite(exp) ? exp : 900);
  }

  @Get('files/:id/download')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  async downloadFile(
    @CurrentUser() user: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.service.getFileStream(user, id);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Disposition', `attachment; filename="${file.fileName.replace(/"/g, '')}"`);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(file.stream);
  }

  @Delete('files/:id')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  deleteFile(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.deleteFile(user, id);
  }

  @Post('files/:id/holds')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  applyHold(
    @CurrentUser() user: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateRetentionHoldDto,
  ) {
    return this.service.applyHold(user, id, dto);
  }

  @Post('holds/:holdId/release')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  releaseHold(
    @CurrentUser() user: Principal,
    @Param('holdId', ParseUUIDPipe) holdId: string,
    @Body() dto: ReleaseRetentionHoldDto,
  ) {
    return this.service.releaseHold(user, holdId, dto);
  }

  @Get('retention/policy')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  getRetentionPolicy(@CurrentUser() user: Principal) {
    return this.service.getRetentionPolicy(user);
  }

  @Put('retention/policy')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  updateRetentionPolicy(@CurrentUser() user: Principal, @Body() dto: UpdateRetentionPolicyDto) {
    return this.service.updateRetentionPolicy(user, dto);
  }

  @Get('retention/dry-run')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  dryRunRetention(@CurrentUser() user: Principal) {
    return this.service.dryRunRetention(user);
  }

  @Post('retention/sweep')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  triggerRetentionSweep(@CurrentUser() user: Principal) {
    return this.service.triggerRetentionSweep(user);
  }

  // --- Public Local Signed URLs ---

  @Get('signed-download')
  async signedDownload(
    @Query('token') token: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!token) throw new NotFoundException('Invalid download token.');
    const verified = this.localProvider.verifySignedToken(token, 'download');
    if (!verified) throw new NotFoundException('Invalid or expired download link.');

    const meta = await this.localProvider.getMetadata(verified.key);
    if (!meta) throw new NotFoundException('Storage file not found.');

    const stream = await this.localProvider.stream(verified.key);
    response.setHeader('Content-Type', meta.mimeType);
    if (verified.filename) {
      response.setHeader('Content-Disposition', `attachment; filename="${verified.filename.replace(/"/g, '')}"`);
    }
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(stream);
  }

  @Put('signed-upload')
  async signedUpload(
    @Query('token') token: string,
    @Req() request: RawBodyRequest,
    @Headers('content-type') contentType: string,
  ) {
    if (!token) throw new NotFoundException('Invalid upload token.');
    const verified = this.localProvider.verifySignedToken(token, 'upload');
    if (!verified) throw new NotFoundException('Invalid or expired upload link.');

    const raw = request.rawBody || Buffer.from([]);
    if (!raw.length) throw new NotFoundException('Empty upload body.');

    const result = await this.localProvider.upload(verified.key, raw, contentType || 'application/octet-stream');
    return { uploaded: true, key: result.key, sizeBytes: result.sizeBytes, sha256: result.sha256 };
  }
}
