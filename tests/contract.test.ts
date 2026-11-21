import { readFileSync } from 'node:fs';
import SwaggerParser from '@apidevtools/swagger-parser';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { fullFormats } from 'ajv-formats/dist/formats.js';
import { describe, expect, it } from 'vitest';

describe('D2 OpenAPI contract', () => {
  it('passes the standard OpenAPI parser and preserves all six modules', async () => {
    await SwaggerParser.validate('docs/openapi.json');
    const spec = JSON.parse(readFileSync('docs/openapi.json', 'utf8'));
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.tags).toHaveLength(6);
    expect(spec.paths['/auth/refresh']?.post).toBeDefined();
    expect(spec.paths['/assignments/{assignmentId}/my-result']?.get).toBeDefined();
  });
  it('keeps credential fields write-only and contains no secret keys', () => {
    const text = readFileSync('docs/openapi.json', 'utf8');
    const spec = JSON.parse(text);
    expect(spec.components.schemas.CreateUserRequest.properties.initialPassword.writeOnly).toBe(true);
    expect(spec.components.schemas.LoginResult.properties.refreshToken).toBeUndefined();
    expect(spec.components.schemas.User.properties.passwordHash).toBeUndefined();
  });
  it('documents published zeroes for enrollments without expanding the public API', () => {
    const spec = JSON.parse(readFileSync('docs/openapi.json', 'utf8'));
    const paths = spec.paths as Record<string, Record<string, { operationId?: string; description?: string }>>;
    const operations = Object.values(paths).flatMap((path) =>
      Object.values(path).filter((operation): operation is { operationId: string; description?: string } =>
        typeof operation.operationId === 'string'),
    );
    expect(operations).toHaveLength(49);
    const descriptions = Object.fromEntries(
      operations.map(({ operationId, description }) => [operationId, description ?? '']),
    );
    const enrollmentRule = /assignments already published[\s\S]*atomically[\s\S]*missing[\s\S]*0/i;
    for (const operationId of ['enrollStudent', 'updateEnrollment']) {
      expect(descriptions[operationId]).toMatch(enrollmentRule);
      expect(descriptions[operationId]).toMatch(/preserv(?:e|es|ing)[\s\S]*(?:grade|history)/i);
      expect(descriptions[operationId]).toContain('AUTO_ZERO_NO_SUBMISSION');
      expect(descriptions[operationId]).toMatch(/no submission/i);
      expect(descriptions[operationId]).toMatch(/locked/i);
    }
    expect(descriptions.publishAssignmentGrades).toMatch(enrollmentRule);
    expect(descriptions.updateUser).toMatch(/reactivating[\s\S]*STUDENT account/i);
    expect(descriptions.updateUser).toMatch(/active enrollment/i);
    expect(descriptions.updateUser).toContain('Published 0');
    expect(operations.some(({ operationId }) => /submission.*note|note.*submission|unpublish/i.test(operationId))).toBe(false);
  });
  it('matches runtime validation for B4 grade mutations', () => {
    const spec = JSON.parse(readFileSync('docs/openapi.json', 'utf8'));
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    const saveGrade = ajv.compile(spec.components.schemas.SaveDraftGradeRequest);
    const correctUnsubmitted = ajv.compile(spec.components.schemas.CorrectUnsubmittedGradeRequest);

    expect(saveGrade({ gradedVersionNumber: 1, score: 8.25, feedback: 'x'.repeat(5000) })).toBe(true);
    expect(saveGrade({ gradedVersionNumber: 1, score: 8, feedback: 'x'.repeat(5001) })).toBe(false);
    expect(saveGrade({ gradedVersionNumber: 1, score: 8, unexpected: true })).toBe(false);
    expect(saveGrade({ gradedVersionNumber: 1, score: -1 })).toBe(false);
    expect(saveGrade({ gradedVersionNumber: 1, score: 8.001 })).toBe(false);
    expect(saveGrade({ gradedVersionNumber: 0, score: 8 })).toBe(false);
    expect(saveGrade({ gradedVersionNumber: 1.5, score: 8 })).toBe(false);
    expect(saveGrade({ score: 8 })).toBe(false);
    expect(correctUnsubmitted({ score: 8.25, feedback: null })).toBe(true);
    expect(correctUnsubmitted({ score: 8.001 })).toBe(false);
    expect(correctUnsubmitted({ score: -1 })).toBe(false);
    expect(correctUnsubmitted({ score: 8, feedback: 'x'.repeat(5001) })).toBe(false);
    expect(correctUnsubmitted({ score: 8, unexpected: true })).toBe(false);
  });
  it('keeps Draft-only fields out of student grade/history and publication blockers', () => {
    const spec = JSON.parse(readFileSync('docs/openapi.json', 'utf8'));
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    for (const [name, format] of Object.entries(fullFormats)) ajv.addFormat(name, format);
    ajv.addSchema({ ...spec, $id: 'contract' });
    const publishedGrade = ajv.compile({ $ref: 'contract#/components/schemas/PublishedGrade' });
    const gradeHistory = ajv.compile({ $ref: 'contract#/components/schemas/GradeHistory' });
    const publicationBlocked = ajv.compile({ $ref: 'contract#/components/schemas/AssignmentPublicationError' });
    const student = { id: '10000000-0000-4000-8000-000000000004', schoolCode: 'SV001',
      fullName: 'Student', role: 'STUDENT' };
    const published = { assignmentId: '50000000-0000-4000-8000-000000000001', student,
      submissionId: null, gradedVersionNumber: null, score: 0, feedback: null, status: 'PUBLISHED',
      source: 'AUTO_ZERO_NO_SUBMISSION', publishedBy: student, publishedAt: '2026-10-26T00:00:00Z' };
    expect(publishedGrade(published)).toBe(true);
    expect(publishedGrade({ ...published, gradedBy: student, gradedAt: '2026-10-26T00:00:00Z' })).toBe(false);
    const history = { assignmentId: published.assignmentId, student, items: [{ version: 1, score: 0,
      feedback: null, status: 'PUBLISHED', source: 'AUTO_ZERO_NO_SUBMISSION', changedBy: student,
      changedAt: '2026-10-26T00:00:00Z' }] };
    expect(gradeHistory(history)).toBe(true);
    expect(gradeHistory({ ...history, items: [{ ...history.items[0], gradedAt: '2026-10-26T00:00:00Z' }] }))
      .toBe(false);
    const blocker = { error: { code: 'UNGRADED_SUBMISSIONS',
      message: 'All submitted work must be graded before publication.', ungradedSubmissions: [{
        submissionId: '60000000-0000-4000-8000-000000000001', student,
      }] } };
    expect(publicationBlocked(blocker)).toBe(true);
    expect(publicationBlocked({ error: { ...blocker.error, ungradedSubmissions: [{
      ...blocker.error.ungradedSubmissions[0], score: 8, feedback: 'private',
    }] } })).toBe(false);
  });
});
