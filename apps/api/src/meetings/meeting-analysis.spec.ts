import { describe, expect, it } from 'vitest';
import { parseTranscriptionResponse, validateMeetingAnalysis } from './meeting-analysis';

describe('meeting transcript grounding', () => {
  const transcript = 'Taylor will prepare the release notes by 2032-05-20. We agreed to freeze features for launch.';
  const segments = [
    { text: 'Taylor will prepare the release notes by 2032-05-20.', startMs: 12_000, endMs: 16_000, speakerLabel: 'speaker_1' },
    { text: 'We agreed to freeze features for launch.', startMs: 19_000, endMs: 22_000, speakerLabel: 'speaker_2' },
  ];

  it('keeps only transcript-supported facts and derives timestamps from source segments', () => {
    const result = validateMeetingAnalysis({
      summary: 'The group assigned the notes and made a feature-freeze decision.',
      summaryEvidence: [segments[0].text, 'The CEO approved a 2035 budget.'],
      objectives: [{ title: 'Prepare the launch', evidence: segments[1].text }],
      topics: [{ title: 'Release notes', evidence: segments[0].text }],
      decisions: [{ title: 'Freeze features', evidence: segments[1].text }],
      actions: [
        { title: 'Prepare release notes', description: 'Draft notes.', evidence: segments[0].text, suggestedOwner: 'Taylor', dueDate: '2099-01-01' },
        { title: 'Increase the budget', evidence: 'The CEO approved a 2035 budget.' },
      ],
      risks: [], unresolvedQuestions: [],
    }, transcript, segments);
    expect(result.summaryEvidence).toEqual([segments[0].text]);
    expect(result.objectives[0].timestampMs).toBe(19_000);
    expect(result.decisions[0].timestampMs).toBe(19_000);
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({ timestampMs: 12_000, dueDate: '2032-05-20T00:00:00.000Z', suggestedOwner: 'Taylor' });
  });

  it('rejects summaries with no verifiable transcript quote', () => {
    expect(() => validateMeetingAnalysis({ summary: 'Unfounded claim', summaryEvidence: ['This was never said.'] }, transcript, segments)).toThrow(/transcript-supported/);
  });

  it('does not derive a date or speaker timestamp when source evidence lacks one', () => {
    const result = validateMeetingAnalysis({
      summary: 'They will follow up.', summaryEvidence: ['Taylor will prepare the release notes.'],
      actions: [{ title: 'Prepare release notes', evidence: 'Taylor will prepare the release notes.' }],
    }, 'Taylor will prepare the release notes.');
    expect(result.actions[0]).toMatchObject({ dueDate: null, timestampMs: null, suggestedOwner: null });
  });

  it('normalizes transcription segments without fabricating missing timing or speakers', () => {
    expect(parseTranscriptionResponse({ text: transcript, segments: [{ text: 'Taylor will prepare the release notes.', start: 2.5, speaker_id: 'speaker_1' }, { text: 'No timestamps.' }] })).toEqual({
      text: transcript,
      segments: [
        { text: 'Taylor will prepare the release notes.', startMs: 2500, endMs: null, speakerLabel: 'speaker_1' },
        { text: 'No timestamps.', startMs: null, endMs: null, speakerLabel: null },
      ],
    });
    expect(() => parseTranscriptionResponse({ text: '' })).toThrow(/no transcript/);
  });
});
