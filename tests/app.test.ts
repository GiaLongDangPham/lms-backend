import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { once } from 'node:events';

const app = createApp({
  corsOrigins: ['http://localhost:5173'],
  checkDatabase: async () => {},
});

describe('S1 infrastructure contract', () => {
  it('reports process health independently of database availability', async () => {
    const offline = createApp({ corsOrigins: [], checkDatabase: async () => { throw new Error('offline'); } });
    const response = await request(offline).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', service: 'lms-backend' });
  });

  it('reports readiness after a database check', async () => {
    const response = await request(app).get('/api/ready');
    expect(response.status).toBe(200);
    expect(response.body.database).toBe('connected');
  });

  it('returns 503 without leaking connection details when the database is down', async () => {
    const offline = createApp({
      corsOrigins: [],
      checkDatabase: async () => { throw new Error('postgresql://secret:password@private-host'); },
    });
    const response = await request(offline).get('/api/ready');
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('DATABASE_UNAVAILABLE');
    expect(response.text).not.toContain('password');
    expect(response.text).not.toContain('private-host');
  });

  it('allows the frontend origin and responds to preflight', async () => {
    const response = await request(app).options('/api/health')
      .set('Origin', 'http://localhost:5173').set('Access-Control-Request-Method', 'GET');
    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('does not expose an allowed-origin header to a different origin', async () => {
    const response = await request(app).get('/api/health').set('Origin', 'https://other.example');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('returns a JSON error for unknown routes', async () => {
    const response = await request(app).get('/api/missing');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects malformed and oversized JSON bodies with client errors', async () => {
    const malformed = await request(app).post('/api/missing').set('Content-Type', 'application/json').send('{');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('INVALID_JSON');
    const oversized = await request(app).post('/api/missing').send({ value: 'x'.repeat(1024 * 1024) });
    expect(oversized.status).toBe(413);
    expect(oversized.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects malformed UTF-8 before JSON decoding can replace Vietnamese characters', async () => {
    const bytes = Buffer.concat([Buffer.from('{"name":"C'), Buffer.from([0xc3, 0x28]), Buffer.from('"}')]);
    const server = app.listen(0, '127.0.0.1');
    try {
      await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing test port');
      const url = `http://127.0.0.1:${address.port}/api/missing`;
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: bytes });
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe('INVALID_ENCODING');
      const utf16 = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-16le' },
        body: Buffer.from('{"name":"Cơ sở dữ liệu"}', 'utf16le') });
      expect(utf16.status).toBe(415); expect((await utf16.json()).error.code).toBe('UNSUPPORTED_CHARSET');
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
});
