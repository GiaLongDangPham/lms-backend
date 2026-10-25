export interface UploadLimits {
  rateLimit: number;
  rateWindowMs: number;
  pendingMaxFiles: number;
  pendingMaxBytes: number;
}

export const defaultUploadLimits: UploadLimits = {
  rateLimit: 20,
  rateWindowMs: 60_000,
  pendingMaxFiles: 20,
  pendingMaxBytes: 250 * 1024 * 1024,
};

export function uploadLimitsFromEnv(): UploadLimits {
  const read = (name: string, fallback: number, max = Number.MAX_SAFE_INTEGER) => {
    const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
    if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`${name} must be a positive safe integer no greater than ${max}.`);
    return value;
  };
  return {
    rateLimit: read('UPLOAD_RATE_LIMIT', defaultUploadLimits.rateLimit),
    rateWindowMs: read('UPLOAD_RATE_WINDOW_MS', defaultUploadLimits.rateWindowMs, 2_147_483_647),
    pendingMaxFiles: read('UPLOAD_PENDING_MAX_FILES', defaultUploadLimits.pendingMaxFiles),
    pendingMaxBytes: read('UPLOAD_PENDING_MAX_BYTES', defaultUploadLimits.pendingMaxBytes),
  };
}
