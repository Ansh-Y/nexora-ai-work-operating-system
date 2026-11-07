export type TranscriptSegmentInput = { startMs?: number | null; endMs?: number | null; speakerLabel?: string | null; text: string };
export type GroundedFact = { title: string; evidence: string; timestampMs: number | null };
export type GroundedAction = GroundedFact & { description: string; suggestedOwner: string | null; dueDate: string | null };
export type ValidMeetingAnalysis = {
  summary: string;
  summaryEvidence: string[];
  objectives: GroundedFact[];
  topics: GroundedFact[];
  decisions: GroundedFact[];
  actions: GroundedAction[];
  risks: GroundedFact[];
  unresolvedQuestions: GroundedFact[];
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function cleanText(value: unknown, limit = 500) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function matchingEvidence(value: unknown, transcript: string, segments: TranscriptSegmentInput[]) {
  const evidence = cleanText(value, 800);
  if (!evidence) return null;
  const normalized = evidence.toLocaleLowerCase().replace(/\s+/g, ' ');
  const match = segments.find(segment => segment.text.toLocaleLowerCase().replace(/\s+/g, ' ').includes(normalized));
  if (match) return { evidence, timestampMs: Number.isInteger(match.startMs) && match.startMs! >= 0 ? match.startMs! : null };
  if (transcript.toLocaleLowerCase().replace(/\s+/g, ' ').includes(normalized)) return { evidence, timestampMs: null };
  return null;
}

function titleSupported(title: string, evidence: string) {
  const terms = title.toLocaleLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
  return terms.some(term => evidence.toLocaleLowerCase().includes(term));
}

function facts(value: unknown, transcript: string, segments: TranscriptSegmentInput[]): GroundedFact[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 30).flatMap(entry => {
    const item = record(entry);
    const title = cleanText(item?.title, 300);
    const source = matchingEvidence(item?.evidence, transcript, segments);
    return title && source && titleSupported(title, source.evidence) ? [{ title, ...source }] : [];
  });
}

export function validateMeetingAnalysis(value: unknown, transcript: string, segments: TranscriptSegmentInput[] = []): ValidMeetingAnalysis {
  const raw = record(value);
  if (!raw) throw new Error('The meeting analysis response was not a JSON object');
  const summary = cleanText(raw.summary, 5000);
  const summaryEvidence = (Array.isArray(raw.summaryEvidence) ? raw.summaryEvidence : [])
    .slice(0, 10)
    .flatMap(item => matchingEvidence(item, transcript, segments)?.evidence ?? []);
  if (!summary || !summaryEvidence.length) throw new Error('The meeting analysis had no transcript-supported summary evidence');
  const decisions = facts(raw.decisions, transcript, segments);
  const actions: GroundedAction[] = (Array.isArray(raw.actions) ? raw.actions : []).slice(0, 40).flatMap(entry => {
    const item = record(entry);
    const title = cleanText(item?.title, 180);
    const source = matchingEvidence(item?.evidence, transcript, segments);
    if (!title || !source || !titleSupported(title, source.evidence)) return [];
    const evidence = source.evidence;
    const explicitDate = evidence.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] ?? null;
    return [{
      title,
      description: cleanText(item?.description, 2000),
      ...source,
      suggestedOwner: cleanText(item?.suggestedOwner, 160) || null,
      // Never accept a normalized deadline that the user did not say verbatim.
      dueDate: explicitDate && !Number.isNaN(Date.parse(explicitDate)) ? new Date(`${explicitDate}T00:00:00.000Z`).toISOString() : null,
    }];
  });
  return {
    summary,
    summaryEvidence,
    objectives: facts(raw.objectives, transcript, segments),
    topics: facts(raw.topics, transcript, segments),
    decisions,
    actions,
    risks: facts(raw.risks, transcript, segments),
    unresolvedQuestions: facts(raw.unresolvedQuestions, transcript, segments),
  };
}

export function parseTranscriptionResponse(value: unknown): { text: string; segments: TranscriptSegmentInput[] } {
  const raw = record(value);
  const text = cleanText(raw?.text, 1_000_000);
  if (!text) throw new Error('The transcription provider returned no transcript text');
  const segments = (Array.isArray(raw?.segments) ? raw.segments : []).slice(0, 10_000).flatMap(entry => {
    const item = record(entry);
    const segmentText = cleanText(item?.text, 10_000);
    if (!segmentText) return [];
    const start = typeof item?.start === 'number' && Number.isFinite(item.start) && item.start >= 0 ? Math.round(item.start * 1000) : null;
    const end = typeof item?.end === 'number' && Number.isFinite(item.end) && item.end >= 0 ? Math.round(item.end * 1000) : null;
    return [{ text: segmentText, startMs: start, endMs: end, speakerLabel: cleanText(item?.speaker_id, 120) || null }];
  });
  return { text, segments };
}
