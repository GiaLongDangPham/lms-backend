import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

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
});
