import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultUploadLimits, uploadLimitsFromEnv } from '../src/modules/materials/upload-limits.js';

const names = ['UPLOAD_RATE_LIMIT', 'UPLOAD_RATE_WINDOW_MS', 'UPLOAD_PENDING_MAX_FILES', 'UPLOAD_PENDING_MAX_BYTES'];
afterEach(() => vi.unstubAllEnvs());
describe('B2 upload limits configuration', () => {
  it('defaults to bounded rate and pending-file limits', () => {
    for (const name of names) vi.stubEnv(name, undefined);
    expect(uploadLimitsFromEnv()).toEqual(defaultUploadLimits);
  });
  it('accepts explicit positive per-deployment limits', () => {
    vi.stubEnv(names[0]!, '5'); vi.stubEnv(names[1]!, '30000');
    vi.stubEnv(names[2]!, '10'); vi.stubEnv(names[3]!, '104857600');
    expect(uploadLimitsFromEnv()).toEqual({ rateLimit: 5, rateWindowMs: 30000, pendingMaxFiles: 10, pendingMaxBytes: 104857600 });
  });
  it('rejects disabled, fractional and invalid limits instead of silently removing protection', () => {
    for (const name of names) {
      for (const value of ['0', '-1', '1.5', 'invalid', '']) {
        vi.stubEnv(name, value); expect(() => uploadLimitsFromEnv()).toThrow(name);
      }
      vi.stubEnv(name, undefined);
    }
    vi.stubEnv('UPLOAD_RATE_WINDOW_MS', '2147483648');
    expect(() => uploadLimitsFromEnv()).toThrow('UPLOAD_RATE_WINDOW_MS');
  });
});
