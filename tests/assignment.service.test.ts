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
