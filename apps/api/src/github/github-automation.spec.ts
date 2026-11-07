import { describe, expect, it } from 'vitest';
import { taskReference } from './github-security';
import { GitHubService } from './github.service';
import { GitHubAutomationTrigger } from '@prisma/client';

describe('GitHub workflow automation unit tests', () => {
  describe('task reference parser', () => {
    it('extracts valid UUID from standard NEXORA-TASK format', () => {
      const uuid = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
      expect(taskReference(`Implement feature NEXORA-TASK:${uuid}`)).toBe(uuid);
      expect(taskReference(`[NEXORA-TASK:${uuid}] fix issue`)).toBe(uuid);
      expect(taskReference(`Multiple lines\nNEXORA-TASK:${uuid}\nDone`)).toBe(uuid);
    });

    it('rejects invalid UUID formats and spoofed prefixes', () => {
      expect(taskReference('NEXORA-TASK:12345')).toBeNull();
      expect(taskReference('NEXORA-TASK:invalid-uuid-token')).toBeNull();
      expect(taskReference('NEXORA-TASK:6ba7b810-9dad-11d1-80b4-00c04fd430c8-toolong')).toBeNull();
      expect(taskReference('TASK:6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBeNull();
      expect(taskReference('NEXORA:6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBeNull();
      expect(taskReference('')).toBeNull();
      expect(taskReference(null)).toBeNull();
      expect(taskReference(undefined)).toBeNull();
    });

    it('handles uppercase and lowercase UUIDs', () => {
      const lower = '123e4567-e89b-12d3-a456-426614174000';
      const upper = '123E4567-E89B-12D3-A456-426614174000';
      expect(taskReference(`NEXORA-TASK:${lower}`)).toBe(lower);
      expect(taskReference(`NEXORA-TASK:${upper}`)).toBe(upper);
    });
  });

  describe('trigger determination', () => {
    // Instantiate service with dummy dependencies (determineTrigger is pure logic)
    const service = new GitHubService({} as any, {} as any, {} as any);

    it('identifies pull request triggers correctly', () => {
      expect(service.determineTrigger('pull_request', { action: 'opened' })).toBe(GitHubAutomationTrigger.PULL_REQUEST_OPENED);
      expect(service.determineTrigger('pull_request', { action: 'synchronize' })).toBe(GitHubAutomationTrigger.PULL_REQUEST_UPDATED);
      expect(service.determineTrigger('pull_request', { action: 'edited' })).toBe(GitHubAutomationTrigger.PULL_REQUEST_UPDATED);
      expect(service.determineTrigger('pull_request', { action: 'closed', pull_request: { merged: true } })).toBe(GitHubAutomationTrigger.PULL_REQUEST_MERGED);
      expect(service.determineTrigger('pull_request', { action: 'closed', pull_request: { merged: false } })).toBe(GitHubAutomationTrigger.PULL_REQUEST_CLOSED);
    });

    it('identifies pull request review triggers', () => {
      expect(service.determineTrigger('pull_request_review', { action: 'submitted', review: { state: 'approved' } })).toBe(GitHubAutomationTrigger.PULL_REQUEST_APPROVED);
      expect(service.determineTrigger('pull_request_review', { action: 'submitted', review: { state: 'commented' } })).toBeNull();
    });

    it('identifies issue triggers', () => {
      expect(service.determineTrigger('issues', { action: 'opened' })).toBe(GitHubAutomationTrigger.ISSUE_OPENED);
      expect(service.determineTrigger('issues', { action: 'closed' })).toBe(GitHubAutomationTrigger.ISSUE_CLOSED);
      expect(service.determineTrigger('issues', { action: 'labeled' })).toBeNull();
    });

    it('identifies push commit triggers', () => {
      expect(service.determineTrigger('push', {})).toBe(GitHubAutomationTrigger.COMMIT_PUSHED);
    });

    it('returns null for unrecognized events', () => {
      expect(service.determineTrigger('ping', {})).toBeNull();
      expect(service.determineTrigger('star', {})).toBeNull();
    });
  });
});
