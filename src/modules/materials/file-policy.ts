import { extname } from 'node:path';
import { open, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import type { Readable } from 'node:stream';
import { TextDecoder } from 'node:util';
import { fileTypeFromFile } from 'file-type';
import yauzl from 'yauzl';
import { ApiError } from '../b1/common.js';
import { allowedOfficePart, inspectOfficePart } from './office-policy.js';

export const maxFileBytes = 25 * 1024 * 1024;
const textMimes: Record<string, string[]> = {
  txt: ['text/plain'], md: ['text/markdown', 'text/plain'], csv: ['text/csv', 'application/vnd.ms-excel', 'text/plain'],
  json: ['application/json', 'text/plain'], xml: ['application/xml', 'text/xml', 'text/plain'],
  html: ['text/html', 'text/plain'], css: ['text/css', 'text/plain'],
  c: ['text/x-c', 'text/plain'], h: ['text/x-c', 'text/plain'], cpp: ['text/x-c++', 'text/plain'],
  hpp: ['text/x-c++', 'text/plain'], java: ['text/x-java-source', 'text/plain'],
  py: ['text/x-python', 'text/plain'], js: ['text/javascript', 'application/javascript', 'text/plain'],
  ts: ['text/typescript', 'application/typescript', 'text/plain'], sql: ['application/sql', 'text/plain'],
};
const binaryMimes: Record<string, string> = {
  pdf: 'application/pdf', doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', zip: 'application/zip',
};
const archiveExts = new Set(['zip', 'rar', '7z', 'gz', 'tar', 'bz2', 'xz', 'docx', 'xlsx', 'pptx']);
const unsupported = () => new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'File extension, declared MIME or file content is not allowed.');
export function fileExtension(name: string): string {
  return extname(name).slice(1).toLowerCase();
}
export function allowedName(name: string): boolean {
  // Reject control characters in the original name before using it in a download header.
  // eslint-disable-next-line no-control-regex
  return !!name && name.length <= 255 && !/[\x00-\x1f\x7f]/.test(name)
    && !/[. ]$/.test(name) && (Object.hasOwn(textMimes, fileExtension(name)) || Object.hasOwn(binaryMimes, fileExtension(name)));
}

// Read every ZIP entry without extracting it; stream decompression to enforce actual byte limits.
export async function inspectZip(path: string, office = false): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) { reject(unsupported()); return; }
      let count = 0; let expanded = 0; let compressed = 0; let settled = false;
      let currentStream: Readable | undefined;
      const fail = () => { if (!settled) { settled = true; currentStream?.destroy(); zip.close(); reject(unsupported()); } };
      zip.on('error', fail);
      zip.on('end', () => { if (!settled) { settled = true; resolve(); } });
      zip.on('entry', (entry: yauzl.Entry) => {
        const name = entry.fileName;
        const directory = name.endsWith('/');
        const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
        const extension = fileExtension(name);
        compressed += entry.compressedSize;
        if (++count > 100 || entry.isEncrypted() || mode === 0xa000 || /(^\/|^[a-z]:|\\)/i.test(name)
          || name.split('/').some(part => part === '..' || part === '.')
          || /vbaproject|activex|macros/i.test(name)
          || (office && !allowedOfficePart(name, directory))
          || (!office && !directory && (!allowedName(name.split('/').at(-1)!) || archiveExts.has(extension)))
          || entry.uncompressedSize > 200 * 1024 * 1024) { fail(); return; }
        if (directory) { zip.readEntry(); return; }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) { fail(); return; }
          currentStream = stream;
          const countBytes = (chunk: Buffer) => {
            expanded += chunk.length;
            if (expanded > 200 * 1024 * 1024 || expanded > Math.max(compressed, 1) * 20) {
              throw unsupported();
            }
          };
          void (async () => {
            try {
              if (office) await inspectOfficePart(stream, name, countBytes);
              else for await (const chunk of stream) countBytes(Buffer.from(chunk));
              currentStream = undefined;
              if (!settled) zip.readEntry();
            } catch { fail(); }
          })();
        });
      });
      zip.readEntry();
    });
  });
}

async function inspectLegacyOffice(path: string, extension: string): Promise<void> {
  const handle = await open(path, 'r');
  try {
    const size = (await handle.stat()).size;
    const header = Buffer.alloc(512); await handle.read(header, 0, 512, 0);
    if (header.subarray(0, 8).toString('hex') !== 'd0cf11e0a1b11ae1') throw unsupported();
    const sectorSize = 2 ** header.readUInt16LE(30);
    if (![512, 4096].includes(sectorSize)) throw unsupported();
    const sector = async (id: number) => {
      const offset = (id + 1) * sectorSize;
      if (offset + sectorSize > size) throw unsupported();
      const data = Buffer.alloc(sectorSize);
      await handle.read(data, 0, sectorSize, offset); return data;
    };
    const fatSectors: number[] = [];
    const seenFat = new Set<number>();
    const addFat = (id: number) => {
      if (id >= 0xfffffffa) return;
      if (seenFat.has(id) || (id + 2) * sectorSize > size || fatSectors.length >= Math.ceil(size / sectorSize)) throw unsupported();
      seenFat.add(id); fatSectors.push(id);
    };
    for (let i = 76; i < 512; i += 4) addFat(header.readUInt32LE(i));
    let difat = header.readUInt32LE(68);
    const visitedDifat = new Set<number>();
    while (difat < 0xfffffffa) {
      if (visitedDifat.has(difat) || visitedDifat.size > Math.ceil(size / sectorSize)) throw unsupported();
      visitedDifat.add(difat);
      const data = await sector(difat);
      for (let i = 0; i < sectorSize - 4; i += 4) {
        addFat(data.readUInt32LE(i));
      }
      difat = data.readUInt32LE(sectorSize - 4);
    }
    if (fatSectors.length !== header.readUInt32LE(44)) throw unsupported();
    const fatBuffers = [];
    for (const id of fatSectors) fatBuffers.push(await sector(id));
    const fat = Buffer.concat(fatBuffers);
    let directory = header.readUInt32LE(48);
    const visited = new Set<number>(); const names = new Set<string>();
    while (directory < 0xfffffffa) {
      if (visited.has(directory) || directory * 4 + 4 > fat.length) throw unsupported();
      visited.add(directory);
      const data = await sector(directory);
      for (let i = 0; i < sectorSize; i += 128) {
        if (!data[i + 66]) continue;
        const length = data.readUInt16LE(i + 64);
        if (length < 2 || length > 64 || length % 2) throw unsupported();
        const name = data.subarray(i, i + length - 2).toString('utf16le').toLowerCase();
        if (/vba|macros|_vba_project/.test(name) || name.includes(String.fromCharCode(1) + 'ole10native')) throw unsupported();
        names.add(name);
      }
      directory = fat.readUInt32LE(directory * 4);
    }
    const expected = { doc: ['worddocument'], xls: ['workbook', 'book'], ppt: ['powerpoint document'] }[extension]!;
    if (!expected.some(name => names.has(name))) throw unsupported();
  } catch { throw unsupported(); }
  finally { await handle.close(); }
}

export async function validateFile(path: string, name: string, declaredMime: string): Promise<{ size: number; mime: string }> {
  if (!allowedName(name)) throw unsupported();
  const { size } = await stat(path);
  if (size > maxFileBytes) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'File exceeds 25 MiB.');
  if (!size) throw new ApiError(400, 'VALIDATION_ERROR', 'File must not be empty.');
  const extension = fileExtension(name);
  const declared = declaredMime.toLowerCase().split(';')[0]!;
  let detected;
  try { detected = await fileTypeFromFile(path); } catch { throw unsupported(); }
  const generic = declared === 'application/octet-stream';
  if (Object.hasOwn(textMimes, extension)) {
    if (detected || (!generic && !textMimes[extension]!.includes(declared))) throw unsupported();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    try {
      for await (const chunk of createReadStream(path)) {
        const text = decoder.decode(chunk as Buffer, { stream: true });
        // Intentionally reject binary control characters while allowing text whitespace.
        // eslint-disable-next-line no-control-regex
        if (/[\x00-\x08\x0e-\x1f]/.test(text)) throw unsupported();
      }
      decoder.decode();
    } catch { throw unsupported(); }
    return { size, mime: textMimes[extension]![0]! };
  }
  const expected = binaryMimes[extension]!;
  if (!generic && declared !== expected && !(extension === 'zip' && declared === 'application/x-zip-compressed')) throw unsupported();
  if (['doc', 'xls', 'ppt'].includes(extension)) {
    await inspectLegacyOffice(path, extension);
    return { size, mime: expected };
  }
  if (detected?.mime !== expected) throw unsupported();
  if (['zip', 'docx', 'xlsx', 'pptx'].includes(extension)) await inspectZip(path, extension !== 'zip');
  if (extension === 'pdf') {
    const handle = await open(path, 'r');
    try { const prefix = Buffer.alloc(5); await handle.read(prefix, 0, 5, 0); if (prefix.toString() !== '%PDF-') throw unsupported(); }
    finally { await handle.close(); }
  }
  return { size, mime: expected };
}
