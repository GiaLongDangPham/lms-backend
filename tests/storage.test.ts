import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { createS3Storage } from '../src/modules/materials/storage.js';

afterEach(() => vi.unstubAllEnvs());
it('streams bytes through S3 SDK PUT/GET/DELETE against a local HTTP fixture', async () => {
  const bodies = new Map<string, Buffer>(); const methods: string[] = []; const authHeaders: string[] = [];
  const server = createServer(async (req, res) => {
    const key = new URL(req.url!, 'http://localhost').pathname;
    methods.push(req.method!); authHeaders.push(req.headers.authorization ?? '');
    if (req.method === 'PUT') {
      const chunks = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      bodies.set(key, Buffer.concat(chunks)); res.setHeader('ETag', '"local-test"'); res.end();
    } else if (req.method === 'GET') {
      const body = bodies.get(key); if (!body) { res.statusCode = 404; res.end(); return; }
      res.setHeader('Content-Length', body.length); res.end(body);
    } else { bodies.delete(key); res.statusCode = 204; res.end(); }
  });
  const directory = await mkdtemp(join(tmpdir(), 'lms-s3-test-'));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing test port');
    vi.stubEnv('S3_BUCKET', 'private-test'); vi.stubEnv('S3_ENDPOINT', `http://127.0.0.1:${address.port}`);
    vi.stubEnv('S3_FORCE_PATH_STYLE', 'true'); vi.stubEnv('AWS_REGION', 'us-east-1');
    vi.stubEnv('AWS_ACCESS_KEY_ID', 'test-only-key'); vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test-only-secret');
    vi.stubEnv('AWS_REQUEST_CHECKSUM_CALCULATION', 'WHEN_REQUIRED');
    const storage = createS3Storage()!;
    const path = join(directory, 'file'); const bytes = Buffer.from('Private lesson — tiếng Việt');
    await writeFile(path, bytes); await storage.put('owner/object', path, bytes.length);
    const stream = await storage.get('owner/object'); const chunks = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(bytes);
    await storage.remove('owner/object'); expect(bodies.size).toBe(0);
    expect(methods).toEqual(['PUT', 'GET', 'DELETE']);
    expect(authHeaders.every(header => header.startsWith('AWS4-HMAC-SHA256'))).toBe(true);
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

it('leaves upload storage unavailable until a private bucket is configured', () => {
  vi.stubEnv('S3_BUCKET', ''); expect(createS3Storage()).toBeUndefined();
});
