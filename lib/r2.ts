import {
  S3Client,
  PutObjectCommand,
  type PutObjectCommandInput,
} from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";

let _s3: S3Client | null = null;

function getR2Client(): S3Client {
  if (!_s3) {
    _s3 = new S3Client({
      region: "auto",
      endpoint: process.env.R2_ENDPOINT!,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY!,
        secretAccessKey: process.env.R2_SECRET_KEY!,
      },
    });
  }
  return _s3;
}

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export async function uploadToR2(
  buffer: Buffer,
  mimeType: string,
  phone: string
): Promise<{ key: string; url: string }> {
  const ext = MIME_TO_EXT[mimeType] || "bin";
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const uuid = randomUUID().slice(0, 8);
  const key = `${phone}/${date}/${uuid}.${ext}`;

  const bucket = process.env.R2_BUCKET || "evara-documents";

  const params: PutObjectCommandInput = {
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
  };

  await getR2Client().send(new PutObjectCommand(params));

  // R2 public URL (if bucket has public access) or just the key
  const url = `${process.env.R2_ENDPOINT}/${bucket}/${key}`;

  console.log(`[r2] Uploaded ${buffer.length} bytes → ${key}`);
  return { key, url };
}
