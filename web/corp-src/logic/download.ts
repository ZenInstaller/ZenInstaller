/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

export type DownloadProgress = (receivedBytes: number, totalBytes: number) => void;

/*
 * Counts bytes as the response streams past
 */
export async function readBlobWithProgress(res: Response, onProgress?: DownloadProgress): Promise<Blob> {
  if (!onProgress || !res.body) return res.blob();

  const total = Number(res.headers.get("Content-Length")) || 0;
  let received = 0;
  let reported = 0;

  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.length;
      // Every megabyte rather than every chunk: this drives React state.
      if (received - reported >= 1_000_000) {
        reported = received;
        onProgress(received, total);
      }
      controller.enqueue(chunk);
    },
    flush() {
      onProgress(received, total);
    },
  });

  return new Response(res.body.pipeThrough(counter)).blob();
}
