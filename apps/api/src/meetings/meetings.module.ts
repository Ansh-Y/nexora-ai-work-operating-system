import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { MeetingAudioStorageService } from './meeting-audio-storage.service';
import { MeetingJobsService } from './meeting-jobs.service';
import { MEETING_ANALYSIS_PROVIDER, OpenAiMeetingAnalysisProvider, OpenAiSpeechToTextProvider, SPEECH_TO_TEXT_PROVIDER } from './meeting-providers';
import { MeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';

@Module({
  imports: [AuthModule, RealtimeModule],
  controllers: [MeetingsController],
  providers: [
    MeetingAudioStorageService,
    MeetingJobsService,
    MeetingsService,
    OpenAiSpeechToTextProvider,
    OpenAiMeetingAnalysisProvider,
    { provide: SPEECH_TO_TEXT_PROVIDER, useExisting: OpenAiSpeechToTextProvider },
    { provide: MEETING_ANALYSIS_PROVIDER, useExisting: OpenAiMeetingAnalysisProvider },
  ],
  exports: [MeetingsService],
})
export class MeetingsModule {}
