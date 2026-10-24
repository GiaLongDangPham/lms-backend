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
});
