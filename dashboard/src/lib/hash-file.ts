import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/** Browser file hashing stays bounded for the same large WZs the server streams. */
export async function hashBrowserFile(file: Blob): Promise<{ hash: string; size: number }> {
  const hash = sha256.create();
  const reader = file.stream().getReader();
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      size += value.byteLength;
    }
  } finally { reader.releaseLock(); }
  return { hash: bytesToHex(hash.digest()), size };
}
