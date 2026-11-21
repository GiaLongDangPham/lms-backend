import * as assignmentService from '../src/modules/assignments/assignment.service.js';
import { describe, expect, it } from 'vitest';

describe('isAfterDeadline', () => {
  it('treats equal timestamps as on time and only later instants as past the deadline', () => {
    const at = new Date('2026-10-24T12:00:00.000Z');
    const isAfterDeadline = (assignmentService as Record<string, unknown>).isAfterDeadline as
      (submittedAt: Date, deadlineAt: Date) => boolean;

    expect(isAfterDeadline(at, at)).toBe(false);
    expect(isAfterDeadline(new Date(at.getTime() + 1), at)).toBe(true);
    expect(isAfterDeadline(new Date(at.getTime() - 1), at)).toBe(false);
  });
});

describe('studentAssignmentCapability', () => {
  const capability = (assignmentService as Record<string, unknown>).studentAssignmentCapability as
    ((state: { submitted_at: Date | null; deadline_at_submission: Date | null;
      graded: boolean; deadline_locked: boolean } | undefined, resultsPublished: boolean) => {
        mySubmissionStatus: string; canSubmit: boolean; lockedReason: string | null;
      }) | undefined;

  it('locks an automatic zero without requiring a submission', () => {
    expect(capability).toBeTypeOf('function');
    if (!capability) return;
    expect(capability({ submitted_at: null, deadline_at_submission: null,
      graded: true, deadline_locked: false },true)).toEqual({
      mySubmissionStatus: 'GRADED', canSubmit: false, lockedReason: 'GRADED',
    });
  });

  it('allows a first late submission but locks a later version after the deadline', () => {
    expect(capability).toBeTypeOf('function');
    if (!capability) return;
    expect(capability({ submitted_at: null, deadline_at_submission: null,
      graded: false, deadline_locked: false },false)).toEqual({
      mySubmissionStatus: 'NOT_SUBMITTED', canSubmit: true, lockedReason: null,
    });
    expect(capability({ submitted_at: new Date('2026-11-19T10:00:00Z'),
      deadline_at_submission: new Date('2026-11-19T09:00:00Z'),
      graded: false, deadline_locked: true },false)).toEqual({
      mySubmissionStatus: 'LATE', canSubmit: false, lockedReason: 'DEADLINE_PASSED',
    });
  });

  it('uses publication as a defensive grade lock even when legacy grade data is missing', () => {
    expect(capability).toBeTypeOf('function');
    if (!capability) return;
    expect(capability(undefined,true)).toEqual({
      mySubmissionStatus: 'NOT_SUBMITTED', canSubmit: false, lockedReason: 'GRADED',
    });
  });
});
