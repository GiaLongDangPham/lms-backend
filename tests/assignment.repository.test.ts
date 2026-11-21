import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { AssignmentRepository, type Db } from '../src/modules/assignments/assignment.repository.js';

describe('AssignmentRepository.studentAssignmentState', () => {
  it('scopes the student enrollment to the assignment class', async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const db = {
      async query(text: string, values: unknown[]) {
        calls.push({ text, values });
        return { rows: [{ submitted_at: null, deadline_at_submission: null, graded: false }] };
      },
    } as unknown as Db;
    const repository = new AssignmentRepository({} as pg.Pool);

    await repository.studentAssignmentState(db, 'assignment-id', 'student-id', 'class-id');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.text).toContain('e.class_id=$3');
    expect(calls[0]!.values).toEqual(['assignment-id', 'student-id', 'class-id']);
  });
});
