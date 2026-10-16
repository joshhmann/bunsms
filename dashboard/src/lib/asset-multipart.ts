import Busboy from "busboy";
import { Readable } from "stream";
import { AssetError, beginRelease, stageStream } from "@/lib/assets";
import type { AssetExpectation } from "@/lib/assets";

/** Metadata precedes file parts; file bodies never pass through Request.formData(). */
export async function stageMultipart(request: Request): Promise<{
  releaseId: string; fields: Record<string, string>; keys: string[]; expected: AssetExpectation[];
}> {
  if (!request.body) throw new AssetError("An upload body is required");
  const fields: Record<string, string> = {};
  const keys: string[] = [];
  let expected: AssetExpectation[] = [];
  let releaseId = new URL(request.url).searchParams.get("releaseId") || "";
  let started = false;
  let failure: Error | undefined;
  let queue = Promise.resolve();
  const source = Readable.fromWeb(request.body as never);
  const parser = Busboy({
    headers: Object.fromEntries(request.headers),
    limits: { fileSize: 1024 * 1024 * 1024, files: 1024, fields: 32, fieldSize: 1024 * 1024 },
  });
  return new Promise((resolve, reject) => {
    const fail = (error: unknown) => {
      failure ||= error instanceof Error ? error : new Error(String(error));
      parser.destroy(failure);
      source.destroy();
    };
    parser.on("field", (name, value, info) => {
      if (started) { fail(new AssetError("Upload metadata must precede all file parts")); return; }
      if (info.valueTruncated || fields[name] !== undefined) { fail(new AssetError("Invalid upload metadata")); return; }
      fields[name] = value;
    });
    parser.on("file", (field, file, info) => {
      file.on("error", (error) => { failure ||= error; });
      file.on("limit", () => fail(new AssetError("File exceeds the 1 GiB upload limit", 413)));
      try {
        if (!started) {
          started = true;
          if (fields.expected) {
            expected = JSON.parse(fields.expected) as AssetExpectation[];
            if (!Array.isArray(expected)) throw new AssetError("Expected metadata must be an array");
          }
          if (fields.releaseId && releaseId && fields.releaseId !== releaseId) throw new AssetError("Conflicting release ids");
          releaseId = releaseId || fields.releaseId || beginRelease(
            fields.baseReleaseId !== undefined ? { baseReleaseId: fields.baseReleaseId || null } : {},
          );
        }
        const key = expected[keys.length]?.key || fields.name || info.filename || field;
        keys.push(key);
        file.pause();
        queue = queue.then(async () => {
          if (failure) { file.resume(); return; }
          try { await stageStream(releaseId, key, file); }
          catch (error) { fail(error); }
        });
      } catch (error) { file.resume(); fail(error); }
    });
    parser.on("filesLimit", () => fail(new AssetError("Too many upload files", 413)));
    parser.on("fieldsLimit", () => fail(new AssetError("Too many upload fields", 413)));
    parser.on("error", (error) => { failure ||= error instanceof Error ? error : new Error(String(error)); source.destroy(); });
    source.on("error", fail);
    parser.on("close", async () => {
      await queue;
      if (failure) { reject(failure); return; }
      if (!keys.length) { reject(new AssetError("At least one file is required")); return; }
      if (expected.length && expected.length !== keys.length) { reject(new AssetError("Every file needs matching expected metadata")); return; }
      resolve({ releaseId, fields, keys, expected });
    });
    source.pipe(parser);
  });
}
