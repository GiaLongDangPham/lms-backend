import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import busboy from 'busboy';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finished, pipeline } from 'node:stream/promises';
import type pg from 'pg';
import { createAuth, getPrincipal, requireChangedPassword, type AuthConfig } from '../b1/auth.js';
import { ApiError, nonempty, paging, parse, uuid } from '../b1/common.js';
import { MaterialService } from './material.service.js';
import { FileService } from './file.service.js';
import type { ObjectStorage } from './storage.js';
import { maxFileBytes } from './file-policy.js';
import { defaultUploadLimits, type UploadLimits } from './upload-limits.js';

const fileIds = z.array(uuid).max(10).refine(ids => new Set(ids).size === ids.length);
const input = z.object({ title: nonempty, description: z.string().max(10000).nullable().optional(), fileIds }).strict();

async function receive(req: Request, path: string) {
  let parser: ReturnType<typeof busboy>;
  try { parser = busboy({ headers: req.headers, defParamCharset: 'utf8', limits: {
    files: 1, fileSize: maxFileBytes + 1, fields: 0, parts: 2,
  } }); } catch { throw new ApiError(400, 'VALIDATION_ERROR', 'Expected multipart/form-data with one file.'); }
  let name = ''; let mime = ''; let problem: ApiError | undefined;
  const writes: Promise<void>[] = [];
  parser.on('file', (field, stream, info) => {
    if (field !== 'file' || !info.filename) {
      problem = new ApiError(400, 'VALIDATION_ERROR', 'Expected exactly one file field.'); stream.resume(); return;
    }
    name = info.filename; mime = info.mimeType;
    stream.on('limit', () => { problem = new ApiError(413, 'PAYLOAD_TOO_LARGE', 'File exceeds 25 MiB.'); });
    // Observe rejection immediately, then await it after the multipart stream is drained.
    writes.push(pipeline(stream, createWriteStream(path, { flags: 'wx', mode: 0o600 })).catch(() => {
      problem = new ApiError(400, 'INVALID_UPLOAD', 'File transfer failed.');
    }));
  });
  for (const event of ['filesLimit', 'fieldsLimit', 'partsLimit'] as const) parser.on(event, () => {
    problem = new ApiError(400, 'VALIDATION_ERROR', 'Expected exactly one file field.');
  });
  const abort = () => { parser.destroy(new Error('Upload interrupted')); };
  req.once('aborted', abort); req.once('error', abort);
  req.pipe(parser);
  try { await finished(parser, { cleanup: true }); }
  catch { problem = new ApiError(400, 'INVALID_UPLOAD', 'Malformed or interrupted file transfer.'); }
  finally {
    req.off('aborted', abort); req.off('error', abort);
    req.unpipe(parser); req.resume();
  }
  await Promise.all(writes);
  if (problem) throw problem;
  if (!name) throw new ApiError(400, 'VALIDATION_ERROR', 'A file is required.');
  return { name, mime };
}

export function createMaterialRouter(pool: pg.Pool, config: AuthConfig, storage?: ObjectStorage,
  configuredLimits: Partial<UploadLimits> = {}) {
  const router = Router(); const auth = createAuth(pool, config);
  const limits = { ...defaultUploadLimits, ...configuredLimits };
  const materials = new MaterialService(pool); const files = new FileService(pool, storage, limits);
  const uploadLimiter = rateLimit({ windowMs: limits.rateWindowMs, limit: limits.rateLimit,
    keyGenerator: req => getPrincipal(req).user.id, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: { code: 'UPLOAD_RATE_LIMITED', message: 'Too many upload attempts. Try again later.' } } });
  // Apply middleware only on this module's paths; do not intercept unrelated routes.
  const requireMember: RequestHandler = (req, _res, next) => {
    if (getPrincipal(req).user.role === 'ADMIN') throw new ApiError(403, 'FORBIDDEN', 'This module is available to teachers and students.');
    next();
  };
  const guards = [auth.authenticate, requireChangedPassword, requireMember];
  router.post('/files', ...guards, uploadLimiter, async (req, res) => {
    const principal = getPrincipal(req);
    const directory = await mkdtemp(join(tmpdir(), 'lms-upload-'));
    try {
      const path = join(directory, 'body');
      const { name, mime } = await receive(req, path);
      res.status(201).json(await files.upload(principal, path, name, mime));
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  router.get('/files/:id/download', ...guards, async (req, res) => {
    const { file, stream } = await files.download(getPrincipal(req), parse(uuid, req.params.id));
    res.set({ 'Content-Type': 'application/octet-stream', 'Cache-Control': 'private, no-store',
      'Content-Disposition': `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(file.original_name).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16)}`)}` });
    await pipeline(stream, res);
  });
  router.get('/classes/:id/materials', ...guards, async (req, res) => {
    res.json(await materials.list(getPrincipal(req), parse(uuid, req.params.id), parse(paging.strict(), req.query)));
  });
  router.post('/classes/:id/materials', ...guards, async (req, res) => {
    res.status(201).json(await materials.create(getPrincipal(req), parse(uuid, req.params.id), parse(input, req.body)));
  });
  router.get('/materials/:id', ...guards, async (req, res) => {
    res.json(await materials.get(getPrincipal(req), parse(uuid, req.params.id)));
  });
  router.patch('/materials/:id', ...guards, async (req, res) => {
    const body = parse(input.partial().refine(value => Object.keys(value).length > 0), req.body);
    res.json(await materials.update(getPrincipal(req), parse(uuid, req.params.id), body));
  });
  return router;
}
