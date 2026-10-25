import { extname } from 'node:path';
import type { Readable } from 'node:stream';
import { TextDecoder } from 'node:util';
import { fileTypeFromBuffer } from 'file-type';
import sax from 'sax';
import { ApiError } from '../b1/common.js';

const imageMimes: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
};
const xmlExtensions = new Set(['xml', 'rels', 'vml']);
const blockedParts = /^(embeddings?|oleobjects?|activex|externallinks|macros)$/i;
const activeContent = /oleobject|vbaproject|macroenabled|activex|officedocument\.package|msdownload|executable|\/(?:package|afchunk|control)$/i;
const externalTarget = /^(?:[a-z][a-z\d+.-]*:|\/\/|\\)/i;
const unsupported = () => new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Office package contains unsupported or active content.');

function extensionOf(name: string) {
  return name.toLowerCase().endsWith('.rels') ? 'rels' : extname(name).slice(1).toLowerCase();
}

export function allowedOfficePart(name: string, directory: boolean): boolean {
  if (name.split('/').some(part => blockedParts.test(part))) return false;
  const extension = extensionOf(name);
  return directory || xmlExtensions.has(extension) || Object.hasOwn(imageMimes, extension);
}

// XML attributes are decoded by the parser, so character references cannot hide External/OLE types.
export async function inspectOfficePart(stream: Readable, name: string, countBytes: (chunk: Buffer) => void) {
  const extension = extensionOf(name);
  const xml = xmlExtensions.has(extension) ? sax.parser(true, { xmlns: true }) : undefined;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const prefix: Buffer[] = []; let prefixSize = 0;
  if (xml) {
    xml.onerror = () => { throw unsupported(); };
    xml.ondoctype = () => { throw unsupported(); };
    xml.onopentag = tag => {
      // OPC attributes are unqualified and case-sensitive. A namespaced/lookalike attribute
      // must not shadow TargetMode, Type or Target when checking active relationships.
      const attrs = new Map(Object.values(tag.attributes).flatMap(attribute =>
        typeof attribute === 'string' || attribute.uri ? [] : [[attribute.local, attribute.value] as const]));
      const local = ('local' in tag ? tag.local : tag.name).toLowerCase();
      if (local === 'oleobject' || activeContent.test(attrs.get('ContentType') ?? '')
        || activeContent.test(attrs.get('Type') ?? '')) throw unsupported();
      const mode = attrs.get('TargetMode');
      if (mode && mode.trim().toLowerCase() !== 'internal') throw unsupported();
      for (const key of ['Target', 'src', 'href']) {
        if (externalTarget.test((attrs.get(key) ?? '').trim())) throw unsupported();
      }
    };
  }
  for await (const data of stream) {
    const chunk = Buffer.from(data); countBytes(chunk);
    if (xml) xml.write(decoder.decode(chunk, { stream: true })).flush();
    else if (prefixSize < 4100) {
      const part = chunk.subarray(0, 4100 - prefixSize); prefix.push(part); prefixSize += part.length;
    }
  }
  if (xml) xml.write(decoder.decode()).close();
  else {
    const detected = await fileTypeFromBuffer(Buffer.concat(prefix));
    if (detected?.mime !== imageMimes[extension]) throw unsupported();
  }
}
