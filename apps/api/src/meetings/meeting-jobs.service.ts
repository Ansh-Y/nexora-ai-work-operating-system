import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MeetingProcessingState, Prisma } from '@prisma/client';
import { Job, Queue, Worker } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Principal } from '../common/auth.types';
import { MeetingAudioStorageService } from './meeting-audio-storage.service';
import { MEETING_ANALYSIS_PROVIDER, MeetingAnalysisProvider, ProviderNotConfiguredError, SPEECH_TO_TEXT_PROVIDER, SpeechToTextProvider } from './meeting-providers';
import { Inject } from '@nestjs/common';
import type { TranscriptSegmentInput } from './meeting-analysis';
import { reminderRedisConnection } from '../notifications/reminder-policy';

type MeetingAudioJob = { organizationId: string; meetingId: string; recordingId: string; generation: number };
const QUEUE_NAME = 'nexora-meeting-processing';
const JOB_NAME = 'transcribe-and-analyze';

@Injectable()
export class MeetingJobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MeetingJobsService.name);
  private queue?: Queue<MeetingAudioJob>;
  private worker?: Worker<MeetingAudioJob>;
  private stopping = false;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private storage: MeetingAudioStorageService,
    private audit: AuditService,
    @Inject(SPEECH_TO_TEXT_PROVIDER) private transcription: SpeechToTextProvider,
    @Inject(MEETING_ANALYSIS_PROVIDER) private analysis: MeetingAnalysisProvider,
  ) {}

  async onModuleInit() {
    const redisUrl = this.config.get<string>('REDIS_URL');
    if (!redisUrl) { this.logger.warn('Meeting transcription is queued only when REDIS_URL is configured'); return; }
    try {
      const connection = reminderRedisConnection(redisUrl);
      this.queue = new Queue<MeetingAudioJob>(QUEUE_NAME, { connection: { ...connection, maxRetriesPerRequest: 1, enableOfflineQueue: false } });
      this.worker = new Worker<MeetingAudioJob>(QUEUE_NAME, job => this.process(job), { connection, concurrency: 2, maxStalledCount: 2, stalledInterval: 30_000 });
      this.queue.on('error', error => this.logger.warn(`Meeting queue connection error: ${error.message}`));
      this.worker.on('error', error => this.logger.warn(`Meeting worker connection error: ${error.message}`));
      this.worker.on('failed', (job, error) => {
        this.logger.error(`Meeting job ${job?.id || 'unknown'} failed on attempt ${job?.attemptsMade ?? 0}/${job?.opts.attempts ?? 3}: ${error.message}`);
        if (job && job.attemptsMade >= (job.opts.attempts ?? 3)) void this.markFailed(job.data, error.message);
      });
    } catch (error) {
      this.logger.error(`Meeting processing queue could not start: ${(error as Error).message}`);
    }
  }

  async onModuleDestroy() {
    this.stopping = true;
    await this.worker?.close();
    await this.queue?.close();
  }

  async enqueue(data: MeetingAudioJob) {
    if (!this.queue || this.stopping) {
      await this.markFailed(data, 'Meeting processing queue is unavailable. Check Redis, then retry processing.');
      return false;
    }
    try {
      await this.queue.add(JOB_NAME, data, {
        jobId: `meeting-audio-${data.recordingId}-${data.generation}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      });
      return true;
    } catch (error) {
      await this.markFailed(data, 'Meeting processing could not be queued. Check Redis, then retry processing.');
      this.logger.error(`Could not enqueue meeting audio: ${(error as Error).message}`);
      return false;
    }
  }

  async retry(user: Principal, meetingId: string, recordingId: string) {
    const recording = await this.prisma.meetingRecording.findFirst({ where: { id: recordingId, meetingId, organizationId: user.orgId } });
    if (!recording) throw new BadRequestException('Recording not found');
    if (!recording.transcript && !this.transcription.isConfigured()) throw new BadRequestException('Configure a speech-to-text provider before retrying. The uploaded recording is retained.');
    if (!this.analysis.isConfigured()) throw new BadRequestException('Configure OPENAI_API_KEY before retrying analysis. The uploaded recording and transcript are retained.');
    if (!this.queue) throw new ServiceUnavailableException('Meeting processing is offline. Configure Redis, then retry.');
    const generation = recording.processingGeneration + 1;
    const claimed = await this.prisma.meetingRecording.updateMany({
      where: { id: recordingId, meetingId, organizationId: user.orgId, processingState: { in: [MeetingProcessingState.FAILED, MeetingProcessingState.AWAITING_CONFIGURATION, MeetingProcessingState.NOT_STARTED] } },
      data: { processingState: MeetingProcessingState.QUEUED, processingError: null, processingGeneration: { increment: 1 } },
    });
    if (!claimed.count) throw new BadRequestException('This recording is already queued or processed');
    await this.prisma.meeting.updateMany({ where: { id: meetingId, organizationId: user.orgId }, data: { processingState: MeetingProcessingState.QUEUED, processingError: null } });
    return { queued: await this.enqueue({ organizationId: user.orgId, meetingId, recordingId, generation }) };
  }

  private async process(job: Job<MeetingAudioJob>) {
    const data = job.data;
    const recording = await this.prisma.meetingRecording.findFirst({ where: { id: data.recordingId, meetingId: data.meetingId, organizationId: data.organizationId }, include: { meeting: true } });
    if (!recording || recording.processingGeneration !== data.generation) return { ignored: true };
    const latest = await this.prisma.meetingRecording.findFirst({ where: { meetingId: data.meetingId, organizationId: data.organizationId }, orderBy: { version: 'desc' }, select: { id: true } });
    if (latest?.id !== recording.id) return { ignored: true };

    try {
      let transcript = recording.transcript;
      let segments: TranscriptSegmentInput[] = await this.prisma.transcriptSegment.findMany({ where: { recordingId: recording.id, organizationId: data.organizationId }, orderBy: { sequence: 'asc' }, select: { text: true, startMs: true, endMs: true, speakerLabel: true } });
      if (!transcript) {
        if (!this.transcription.isConfigured()) throw new ProviderNotConfiguredError('Configure TRANSCRIPTION_API_KEY or OPENAI_API_KEY to transcribe meeting audio. The uploaded file is retained.');
        await this.setState(data, MeetingProcessingState.TRANSCRIBING);
        const bytes = await this.storage.read(data.organizationId, recording.storageKey);
        const output = await this.transcription.transcribe(bytes, recording.fileName, recording.mimeType);
        transcript = output.text;
        await this.prisma.$transaction(async tx => {
          await tx.meetingRecording.update({ where: { id: recording.id }, data: { transcript, transcriptionProvider: output.provider, processingState: this.analysis.isConfigured() ? MeetingProcessingState.ANALYZING : MeetingProcessingState.AWAITING_CONFIGURATION, processingError: this.analysis.isConfigured() ? null : 'Configure OPENAI_API_KEY to generate the meeting summary.' } });
          await tx.meeting.update({ where: { id: data.meetingId }, data: { transcript, summary: null, summaryEvidence: Prisma.DbNull, objectives: Prisma.DbNull, discussionTopics: Prisma.DbNull, risks: Prisma.DbNull, unresolvedQuestions: Prisma.DbNull, analysisRecordingId: null, processingState: this.analysis.isConfigured() ? MeetingProcessingState.ANALYZING : MeetingProcessingState.AWAITING_CONFIGURATION, processingError: this.analysis.isConfigured() ? null : 'Configure OPENAI_API_KEY to generate the meeting summary.' } });
          await tx.transcriptSegment.deleteMany({ where: { recordingId: recording.id, organizationId: data.organizationId } });
          if (output.segments.length) await tx.transcriptSegment.createMany({ data: output.segments.map((segment, sequence) => ({ organizationId: data.organizationId, meetingId: data.meetingId, recordingId: recording.id, sequence, startMs: segment.startMs, endMs: segment.endMs, speakerLabel: segment.speakerLabel, text: segment.text })) });
        });
        segments = output.segments;
      }
      if (!this.analysis.isConfigured()) {
        await this.setState(data, MeetingProcessingState.AWAITING_CONFIGURATION, 'Configure OPENAI_API_KEY to generate the meeting summary. The transcript is retained.');
        return { transcripted: true, analysisConfigured: false };
      }
      const currentMeeting = await this.prisma.meeting.findFirst({ where: { id: data.meetingId, organizationId: data.organizationId }, select: { analysisRecordingId: true, summary: true } });
      if (currentMeeting && currentMeeting.analysisRecordingId === recording.id && currentMeeting.summary) return { alreadyAnalyzed: true };
      await this.setState(data, MeetingProcessingState.ANALYZING);
      const result = await this.analysis.analyze(transcript, segments.map(segment => ({ text: segment.text, startMs: segment.startMs, endMs: segment.endMs, speakerLabel: segment.speakerLabel })));
      await this.prisma.$transaction(async tx => {
        const [decisionCount, actionCount] = await Promise.all([
          tx.meetingDecision.count({ where: { meetingId: data.meetingId, organizationId: data.organizationId } }),
          tx.meetingActionItem.count({ where: { meetingId: data.meetingId, organizationId: data.organizationId } }),
        ]);
        await tx.meeting.update({ where: { id: data.meetingId }, data: {
          transcript, summary: result.summary, summaryEvidence: result.summaryEvidence, objectives: result.objectives,
          discussionTopics: result.topics, risks: result.risks, unresolvedQuestions: result.unresolvedQuestions,
          decisions: result.decisions.map(item => item.title), actionItems: result.actions.map(item => item.title),
          analysisRecordingId: recording.id, processingState: MeetingProcessingState.COMPLETE, processingError: null, status: 'READY',
        } });
        if (result.decisions.length) await tx.meetingDecision.createMany({ data: result.decisions.map((item, index) => ({ organizationId: data.organizationId, meetingId: data.meetingId, recordingId: recording.id, sequence: decisionCount + index, title: item.title, evidence: item.evidence, timestampMs: item.timestampMs })) });
        if (result.actions.length) await tx.meetingActionItem.createMany({ data: result.actions.map((item, index) => ({ organizationId: data.organizationId, meetingId: data.meetingId, projectId: recording.meeting.projectId, recordingId: recording.id, sequence: actionCount + index, title: item.title, description: item.description, evidence: item.evidence, timestampMs: item.timestampMs, suggestedOwner: item.suggestedOwner, dueDate: item.dueDate ? new Date(item.dueDate) : null, expiresAt: new Date(Date.now() + 7 * 86400000) })) });
        await tx.meetingRecording.update({ where: { id: recording.id }, data: { processingState: MeetingProcessingState.COMPLETE, processingError: null } });
        await tx.auditEvent.create({ data: { organizationId: data.organizationId, actorType: 'AI', actorId: recording.uploadedById, action: 'meeting.analysis.completed', targetType: 'meeting', targetId: data.meetingId, metadata: { recordingId: recording.id, decisionCount: result.decisions.length, actionCount: result.actions.length } } });
      });
      return { analyzed: true };
    } catch (error) {
      if (error instanceof ProviderNotConfiguredError) {
        await this.setState(data, MeetingProcessingState.AWAITING_CONFIGURATION, error.message);
        return { configured: false };
      }
      throw error;
    }
  }

  private async setState(data: MeetingAudioJob, state: MeetingProcessingState, error: string | null = null) {
    await this.prisma.$transaction(async tx => {
      await tx.meetingRecording.updateMany({ where: { id: data.recordingId, organizationId: data.organizationId, processingGeneration: data.generation }, data: { processingState: state, processingError: error } });
      await tx.meeting.updateMany({ where: { id: data.meetingId, organizationId: data.organizationId }, data: { processingState: state, processingError: error, status: state === MeetingProcessingState.FAILED ? 'FAILED' : 'PROCESSING' } });
    });
  }

  private async markFailed(data: MeetingAudioJob, message: string) {
    if (this.stopping) return;
    await this.setState(data, MeetingProcessingState.FAILED, message).catch(error => this.logger.error(`Could not persist meeting job failure: ${(error as Error).message}`));
    await this.audit.append({ organizationId: data.organizationId, actorType: 'SYSTEM', action: 'meeting.processing.failed', targetType: 'meeting', targetId: data.meetingId, metadata: { recordingId: data.recordingId, message: message.slice(0, 500) } }).catch(error => this.logger.error(`Could not audit meeting failure: ${(error as Error).message}`));
  }
}
