import { validateMeetingAnalysis } from '../src/meetings/meeting-analysis';
import { MeetingAnalysisProvider, SpeechToTextProvider } from '../src/meetings/meeting-providers';

export const meetingTestTranscript = 'Taylor will prepare the release notes by 2032-05-20. We agreed to freeze features for the launch.';

export const meetingTestSpeechProvider: SpeechToTextProvider = {
  isConfigured: () => true,
  async transcribe() {
    const segments = [
      { startMs: 12_000, endMs: 16_000, speakerLabel: 'speaker_1', text: 'Taylor will prepare the release notes by 2032-05-20.' },
      { startMs: 19_000, endMs: 22_000, speakerLabel: 'speaker_2', text: 'We agreed to freeze features for the launch.' },
    ];
    return { text: meetingTestTranscript, segments, provider: 'fixture' };
  },
};

export const meetingTestAnalysisProvider: MeetingAnalysisProvider = {
  isConfigured: () => true,
  async analyze(transcript, segments) {
    return validateMeetingAnalysis({
      summary: 'The team assigned release notes and agreed to freeze features.',
      summaryEvidence: ['Taylor will prepare the release notes by 2032-05-20.', 'We agreed to freeze features for the launch.'],
      objectives: [{ title: 'Prepare the launch', evidence: 'We agreed to freeze features for the launch.' }],
      topics: [{ title: 'Release notes', evidence: 'Taylor will prepare the release notes by 2032-05-20.' }],
      decisions: [{ title: 'Freeze features for launch', evidence: 'We agreed to freeze features for the launch.' }],
      actions: [
        { title: 'Prepare release notes', description: 'Draft the launch release notes.', evidence: 'Taylor will prepare the release notes by 2032-05-20.', suggestedOwner: 'Taylor' },
        { title: 'Freeze feature scope', description: 'Keep the launch scope stable.', evidence: 'We agreed to freeze features for the launch.' },
      ],
      risks: [],
      unresolvedQuestions: [],
    }, transcript, segments);
  },
};
