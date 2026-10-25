import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ZipFile } from 'yazl';
import { afterAll, describe, expect, it } from 'vitest';
import { allowedName, inspectZip, validateFile } from '../src/modules/materials/file-policy.js';

const directory = await mkdtemp(join(tmpdir(), 'lms-policy-test-'));
let index = 0;
async function fixture(bytes: Buffer | string) {
  const path = join(directory, String(++index)); await writeFile(path, bytes); return path;
}
async function zipFile(entries: { name: string; content: string; mode?: number }[], compress = false) {
  const zip = new ZipFile();
  for (const entry of entries) zip.addBuffer(Buffer.from(entry.content), entry.name, { compress, mode: entry.mode });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    zip.outputStream.on('data', chunk => chunks.push(chunk)); zip.outputStream.on('error', reject);
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
  });
  zip.end(); return fixture(await done);
}
function legacyOffice(names: string[]) {
  const header = Buffer.alloc(512, 0); Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(header);
  header.writeUInt16LE(9, 30); header.writeUInt32LE(1, 44); header.writeUInt32LE(1, 48);
  header.writeUInt32LE(0xfffffffe, 68);
  for (let i = 76; i < 512; i += 4) header.writeUInt32LE(i === 76 ? 0 : 0xffffffff, i);
  const fat = Buffer.alloc(512, 255); fat.writeUInt32LE(0xfffffffd, 0); fat.writeUInt32LE(0xfffffffe, 4);
  const directory = Buffer.alloc(512);
  names.forEach((name, index) => {
    const offset = index * 128;
    directory.write(name, offset, 'utf16le'); directory.writeUInt16LE((name.length + 1) * 2, offset + 64);
    directory[offset + 66] = 2;
  });
  return Buffer.concat([header, fat, directory]);
}
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

describe('Q08 upload content policy', () => {
  it('normalizes the final extension and rejects control characters, unknown names and executables', () => {
    for (const name of ['Bài giảng.PDF', 'answer.py', 'notes.xlsx']) expect(allowedName(name)).toBe(true);
    for (const name of ['answer', 'answer.exe', 'answer.pdf.exe', 'answer.pdf ', 'answer\n.pdf', 'answer.docm']) expect(allowedName(name)).toBe(false);
  });
  it('rejects inherited JavaScript property names as extensions with 415 instead of a server error', async () => {
    const path = await fixture('plain text');
    for (const name of ['file.constructor', 'file.__proto__']) {
      expect(allowedName(name)).toBe(false);
      await expect(validateFile(path, name, 'application/octet-stream')).rejects.toMatchObject({ status: 415 });
    }
  });
  it('accepts UTF-8 source files and rejects binary or invalid UTF-8 under a text extension', async () => {
    expect(await validateFile(await fixture('Xin chào\nconst x = 1;'), 'answer.ts', 'application/octet-stream'))
      .toMatchObject({ mime: 'text/typescript' });
    await expect(validateFile(await fixture(Buffer.from([0xff, 0xfe, 0, 1, 2])), 'fake.txt', 'text/plain')).rejects.toMatchObject({ status: 415 });
    await expect(validateFile(await fixture('plain text'), 'fake.pdf', 'application/pdf')).rejects.toMatchObject({ status: 415 });
  });
  it('accepts PDFs but rejects a misleading declared MIME', async () => {
    const pdf = await fixture('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF');
    expect(await validateFile(pdf, 'lesson.PDF', 'application/pdf')).toMatchObject({ mime: 'application/pdf' });
    await expect(validateFile(pdf, 'lesson.pdf', 'image/png')).rejects.toMatchObject({ status: 415 });
  });
  it('accepts safe ZIPs and rejects executables, nested archives, symlinks and compression bombs', async () => {
    await expect(inspectZip(await zipFile([{ name: 'folder/answer.txt', content: 'notes' }]))).resolves.toBeUndefined();
    for (const entry of [
      { name: 'setup.exe', content: 'denied' }, { name: 'nested.zip', content: 'nested' },
      { name: 'link.txt', content: 'target', mode: 0o120777 },
    ]) await expect(inspectZip(await zipFile([entry]))).rejects.toMatchObject({ status: 415 });
    await expect(inspectZip(await zipFile([{ name: 'bomb.txt', content: 'a'.repeat(1024 * 1024) }], true)))
      .rejects.toMatchObject({ status: 415 });
    await expect(inspectZip(await zipFile(Array.from({ length: 101 }, (_, n) => ({ name: `${n}.txt`, content: 'ok' })))))
      .rejects.toMatchObject({ status: 415 });
  });
  it('rejects traversal paths and macro-bearing OOXML packages', async () => {
    const zip = await zipFile([{ name: 'folder/answer.txt', content: 'safe' }]);
    const { readFile } = await import('node:fs/promises');
    const bytes = await readFile(zip);
    // Replace same-length names in both the local and central ZIP directory.
    await writeFile(zip, Buffer.from(bytes.toString('latin1').replaceAll('folder/answer.txt', '../bad/answer.txt'), 'latin1'));
    await expect(inspectZip(zip)).rejects.toMatchObject({ status: 415 });
    await expect(inspectZip(await zipFile([{ name: 'word/vbaProject.bin', content: 'macro' }]), true))
      .rejects.toMatchObject({ status: 415 });
  });
  it('distinguishes legacy Office formats and rejects embedded VBA streams', async () => {
    const doc = await fixture(legacyOffice(['WordDocument']));
    expect(await validateFile(doc, 'lesson.doc', 'application/msword')).toMatchObject({ mime: 'application/msword' });
    await expect(validateFile(doc, 'lesson.xls', 'application/vnd.ms-excel')).rejects.toMatchObject({ status: 415 });
    await expect(validateFile(await fixture(legacyOffice(['WordDocument', 'VBA'])), 'lesson.doc', 'application/msword'))
      .rejects.toMatchObject({ status: 415 });
  });
});
