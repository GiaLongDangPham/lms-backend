import { readFileSync } from 'node:fs';
import SwaggerParser from '@apidevtools/swagger-parser';
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
    const operations = Object.values(spec.paths).flatMap((path: any) =>
      Object.values(path).filter((operation: any) => operation.operationId),
    ) as Array<{ operationId: string; description?: string }>;
    expect(operations).toHaveLength(48);
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
    expect(operations.some(({ operationId }) => /submission.*note|note.*submission|unpublish/i.test(operationId))).toBe(false);
  });
});
