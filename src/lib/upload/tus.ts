"use client";

import * as tus from "tus-js-client";
import { accessToken } from "@/lib/supabase/client";
import { BUCKET } from "@/lib/storage";

export type UploadHandle = { promise: Promise<void>; abort: () => void };

/**
 * Resumable (TUS) upload to Supabase Storage: 6 MB chunks, automatic retries,
 * progress events and resume after a network drop — required for large WAVs.
 */
export function tusUpload(
  file: Blob,
  objectName: string,
  contentType: string,
  onProgress: (fraction: number) => void,
): UploadHandle {
  let upload: tus.Upload | null = null;
  let aborted = false;
  const promise = new Promise<void>((resolve, reject) => {
    upload = new tus.Upload(file, {
      endpoint: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/upload/resumable`,
      retryDelays: [0, 2000, 5000, 10000, 20000],
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        "x-upsert": "true",
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: 6 * 1024 * 1024,
      metadata: {
        bucketName: BUCKET,
        objectName,
        contentType,
        cacheControl: "31536000",
      },
      // Fresh token on every request: long uploads outlive the access token.
      onBeforeRequest: async (req) => {
        req.setHeader("authorization", `Bearer ${await accessToken()}`);
      },
      onProgress: (sent, total) => onProgress(total ? sent / total : 0),
      onError: (err) => reject(aborted ? new Error("Import annulé") : err),
      onSuccess: () => resolve(),
    });
    upload
      .findPreviousUploads()
      .then((previous) => {
        if (previous.length) upload!.resumeFromPreviousUpload(previous[0]);
        upload!.start();
      })
      .catch(reject);
  });
  return {
    promise,
    abort: () => {
      aborted = true;
      void upload?.abort(true);
    },
  };
}
