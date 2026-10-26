import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

export interface ObjectStorage {
  bucket: string;
  put(key: string, path: string, size: number): Promise<void>;
  get(key: string): Promise<Readable>;
  remove(key: string): Promise<void>;
}

export function createS3Storage(): ObjectStorage | undefined {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) return undefined;
  const client = new S3Client({
    region: process.env.AWS_REGION ?? 'us-east-1',
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  });
  return {
    bucket,
    async put(key, path, size) {
      const body = createReadStream(path);
      try {
        await client.send(new PutObjectCommand({ Bucket: bucket, Key: key,
          Body: body, ContentLength: size, ContentType: 'application/octet-stream' }));
      } finally { body.destroy(); }
    },
    async get(key) {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!(result.Body instanceof Readable)) throw new Error('Object body is unavailable.');
      return result.Body;
    },
    async remove(key) { await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })); },
  };
}
