import { Env } from "./types";
import { generateId, getFileExtension } from "./utils";

export interface R2UploadResult {
  key: string;
  size: number;
}

/**
 * Upload a file to R2.
 * Returns the storage key and file size.
 */
export async function uploadFile(
  env: Env,
  userId: string,
  data: ArrayBuffer,
  mimeType?: string,
  fileName?: string,
): Promise<R2UploadResult> {
  const ext = getFileExtension(mimeType, fileName);
  const key = `users/${userId}/${generateId()}.${ext}`;

  await env.EVARA_BUCKET.put(key, data, {
    httpMetadata: {
      contentType: mimeType || "application/octet-stream",
    },
  });

  return { key, size: data.byteLength };
}

/**
 * Download a file from R2.
 */
export async function downloadFile(env: Env, key: string): Promise<{ data: ArrayBuffer; contentType: string } | null> {
  const obj = await env.EVARA_BUCKET.get(key);
  if (!obj) return null;

  const data = await obj.arrayBuffer();
  const contentType = obj.httpMetadata?.contentType || "application/octet-stream";
  return { data, contentType };
}

/**
 * Generate a public URL for an R2 object.
 * Note: For R2 public access, the bucket must have a custom domain or public access enabled.
 * This returns a path-based reference; actual URL depends on your R2 public domain config.
 */
export function getPublicUrl(env: Env, key: string): string {
  // If you have a custom domain for R2, set it here.
  // For now, we return the key — the caller should use the Worker itself as a proxy if needed.
  return `/files/${key}`;
}
