import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import console from 'node:console';
import process from 'node:process';
import { URL } from 'node:url';

const spec = JSON.parse(readFileSync(new URL('../docs/openapi.json', import.meta.url), 'utf8'));
const methods = new Set(['get', 'post', 'put', 'patch', 'delete']);

function resolve(value) {
  if (!value?.$ref) return value;
  if (!value.$ref.startsWith('#/')) throw new Error(`External reference is unsupported: ${value.$ref}`);
  const target = value.$ref.slice(2).split('/').reduce((part, key) => part?.[key.replaceAll('~1', '/').replaceAll('~0', '~')], spec);
  if (!target) throw new Error(`Unresolved reference: ${value.$ref}`);
  return resolve(target);
}

function exampleFor(schema, depth = 0) {
  if (depth > 12) throw new Error('Schema example recursion is too deep.');
  const value = resolve(schema);
  if (Object.hasOwn(value, 'example')) return value.example;
  if (Object.hasOwn(value, 'const')) return value.const;
  if (value.allOf) return Object.assign({}, ...value.allOf.map(part => exampleFor(part, depth + 1)));
  if (value.oneOf || value.anyOf) {
    const choices = value.oneOf ?? value.anyOf;
    return exampleFor(choices.find(part => resolve(part).type !== 'null') ?? choices[0], depth + 1);
  }
  if (value.enum) return value.enum[0];
  if (value.type === 'object') {
    return Object.fromEntries(Object.entries(value.properties ?? {})
      .filter(([, property]) => !resolve(property).writeOnly)
      .map(([key, property]) => [key, exampleFor(property, depth + 1)]));
  }
  if (value.type === 'array') return [exampleFor(value.items, depth + 1)];
  if (Array.isArray(value.type) && value.type.includes('null')) return null;
  if (value.type === 'integer' || value.type === 'number') return 0;
  if (value.type === 'boolean') return false;
  return '';
}

function validate() {
  if (spec.openapi !== '3.1.0') throw new Error('Expected OpenAPI 3.1.0.');
  const tags = new Set(spec.tags.map((tag) => tag.name));
  const ids = new Set();
  let operations = 0;
  for (const [path, pathItem] of Object.entries(spec.paths)) {
    if (!path.startsWith('/')) throw new Error(`Invalid path: ${path}`);
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!methods.has(method)) throw new Error(`Unexpected path item key: ${path} ${method}`);
      if (!operation.operationId || ids.has(operation.operationId)) throw new Error(`Missing or duplicate operationId: ${path} ${method}`);
      ids.add(operation.operationId);
      if (!operation.tags?.every((tag) => tags.has(tag))) throw new Error(`Unknown tag: ${operation.operationId}`);
      if (!operation['x-roles']?.length) throw new Error(`Missing roles: ${operation.operationId}`);
      for (const parameter of operation.parameters ?? []) resolve(parameter);
      if (operation.requestBody) {
        const body = resolve(operation.requestBody);
        for (const media of Object.values(body.content ?? {})) exampleFor(media.schema);
      }
      const success = Object.entries(operation.responses ?? {}).filter(([status]) => status.startsWith('2'));
      if (!success.length) throw new Error(`No success response: ${operation.operationId}`);
      for (const responseRef of Object.values(operation.responses)) {
        const response = resolve(responseRef);
        for (const media of Object.values(response.content ?? {})) {
          if (media.schema?.format !== 'binary') exampleFor(media.schema);
        }
      }
      if (operation['x-roles'].includes('STUDENT')) {
        for (const responseRef of Object.values(operation.responses)) {
          if (responseRef.$ref === '#/components/responses/GradeOk') {
            throw new Error(`Student operation exposes teacher-only Grade: ${operation.operationId}`);
          }
        }
      }
      operations++;
    }
  }
  for (const schema of Object.values(spec.components.schemas)) exampleFor(schema);
  return operations;
}

const operationCount = validate();
if (process.argv.includes('--validate')) {
  console.log(`Draft structural checks passed: ${Object.keys(spec.paths).length} paths, ${operationCount} operations, ${spec.tags.length} modules.`);
  process.exit(0);
}

const port = Number(process.env.MOCK_PORT ?? 4010);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('MOCK_PORT must be an integer from 1 to 65535.');
const routes = Object.entries(spec.paths).map(([path, item]) => ({
  pattern: new RegExp(`^${path.replace(/\{[^}]+\}/g, '[^/]+')}$`),
  item,
}));

if (process.argv.includes('--self-test')) {
  const submissionRoute = routes.find((route) => route.pattern.test('/assignments/50000000-0000-4000-8000-000000000001/my-submission'));
  const submission = exampleFor(resolve(submissionRoute.item.get.responses['200']).content['application/json'].schema);
  assert.equal(submission.versions.length, 2);
  assert.equal(submission.currentVersionNumber, 2);
  assert.equal(submission.canSubmit, false);
  assert.equal(submission.lockedReason, 'GRADED');
  assert.equal(Object.hasOwn(submission, 'score'), false);
  const teacherSubmission = exampleFor(spec.components.schemas.TeacherSubmission);
  assert.ok(teacherSubmission.id);
  assert.equal(teacherSubmission.grade.status, 'DRAFT');
  const result = exampleFor(resolve(spec.paths['/assignments/{assignmentId}/my-result'].get.responses['200']).content['application/json'].schema);
  assert.equal(result.status, 'PUBLISHED');
  assert.equal(result.source, 'MANUAL');
  const draft = exampleFor(resolve(spec.paths['/submissions/{submissionId}/grade'].get.responses['200']).content['application/json'].schema);
  assert.equal(draft.status, 'DRAFT');
  const publication = exampleFor(resolve(spec.paths['/assignments/{assignmentId}/grades/publish'].post.responses['200']).content['application/json'].schema);
  assert.equal(publication.publishedCount, 32);
  assert.equal(publication.automaticZeroCount, 4);
  assert.equal(spec.paths['/submissions/{submissionId}/grade/publish'], undefined);
  const comment = exampleFor(resolve(spec.paths['/submissions/{submissionId}/comments'].post.responses['201']).content['application/json'].schema);
  assert.equal(comment.assignmentId, null);
  assert.ok(comment.submissionId);
  assert.ok(spec.paths['/assignments/{assignmentId}/submissions'].post.responses['409']);
  function send(method, path, headers = {}) {
    const response = {
      status: 0,
      headers: {},
      body: '',
      setHeader(name, value) { this.headers[name] = value; },
      writeHead(status, values = {}) { this.status = status; Object.assign(this.headers, values); },
      end(body = '') { this.body = body; },
    };
    handleRequest({ method, url: path, headers }, response);
    return response;
  }
  const studentSubmission = send('GET', '/api/assignments/50000000-0000-4000-8000-000000000001/my-submission');
  assert.equal(studentSubmission.status, 200);
  assert.equal(JSON.parse(studentSubmission.body).versions.length, 2);
  assert.equal(Object.hasOwn(JSON.parse(studentSubmission.body), 'score'), false);
  const studentResult = send('GET', '/api/assignments/50000000-0000-4000-8000-000000000001/my-result');
  assert.equal(JSON.parse(studentResult.body).status, 'PUBLISHED');
  assert.equal(send('POST', '/api/assignments/50000000-0000-4000-8000-000000000001/submissions', { 'x-mock-status': '409' }).status, 409);
  const blockedPublication = send('POST', '/api/assignments/50000000-0000-4000-8000-000000000001/grades/publish', { 'x-mock-status': '409' });
  assert.equal(blockedPublication.status, 409);
  assert.equal(JSON.parse(blockedPublication.body).error.code, 'UNGRADED_SUBMISSIONS');
  const discovery = send('GET', '/api');
  assert.equal(discovery.status, 200);
  assert.equal(JSON.parse(discovery.body).openapi, '/api/openapi.json');
  assert.equal(send('GET', '/api/missing').status, 404);
  console.log('Mock self-test passed: discovery, HTTP dispatch, submission lock, Draft separation, assignment-wide publication, automatic-zero summary, publication blocker and comment target.');
  process.exit(0);
}

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Mock-Only': 'true' });
  response.end(JSON.stringify(body));
}

function handleRequest(request, response) {
  if (request.headers.origin === 'http://localhost:5173') {
    response.setHeader('Access-Control-Allow-Origin', 'http://localhost:5173');
    response.setHeader('Vary', 'Origin');
  }
  if (request.method === 'OPTIONS') {
    response.writeHead(204, { 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization,Content-Type,X-Mock-Status', 'X-Mock-Only': 'true' });
    response.end();
    return;
  }
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (request.method === 'GET' && (url.pathname === '/api' || url.pathname === '/api/')) {
    json(response, 200, {
      service: 'lms-d2-static-mock',
      openapi: '/api/openapi.json',
      example: '/api/classes',
      warning: 'Static examples only; no auth, validation, persistence or business rules are simulated.',
    });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/openapi.json') {
    json(response, 200, spec);
    return;
  }
  const operation = routes.find((route) => route.pattern.test(url.pathname.replace(/^\/api/, '')))?.item[request.method?.toLowerCase()];
  if (!operation) {
    json(response, 404, { error: { code: 'NOT_FOUND', message: 'Endpoint not found.' } });
    return;
  }
  const requestedStatus = request.headers['x-mock-status'];
  const status = requestedStatus && Object.hasOwn(operation.responses, requestedStatus)
    ? requestedStatus : Object.keys(operation.responses).find((code) => code.startsWith('2'));
  const definition = resolve(operation.responses[status]);
  if (status === '204' || !definition.content) {
    response.writeHead(Number(status), { 'X-Mock-Only': 'true', 'Cache-Control': 'no-store' });
    response.end();
    return;
  }
  const [mediaType, media] = Object.entries(definition.content)[0];
  if (mediaType === 'application/octet-stream') {
    response.writeHead(Number(status), { 'Content-Type': mediaType, 'Content-Disposition': 'attachment; filename="mock-file.txt"', 'X-Mock-Only': 'true' });
    response.end('D2 mock file bytes\n');
    return;
  }
  const body = Object.hasOwn(media, 'example') ? media.example : exampleFor(media.schema);
  json(response, Number(status), body);
}

const server = createServer(handleRequest);

server.listen(port, '127.0.0.1', () => {
  console.log(`Static D2 mock ready (${operationCount} operations).`);
  console.log(`Overview: http://127.0.0.1:${port}/api`);
  console.log(`OpenAPI:  http://127.0.0.1:${port}/api/openapi.json`);
  console.log('No auth, validation, state, file storage or business rules are simulated.');
});
