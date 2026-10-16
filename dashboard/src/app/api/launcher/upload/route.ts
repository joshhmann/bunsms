import { NextResponse } from "next/server";
import { AssetError, beginRelease, publishRelease, releaseFileNames, stageFile } from "@/lib/assets";
import { stageMultipart } from "@/lib/asset-multipart";
import { isPrivateRequestAuthorized } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    if (!await isPrivateRequestAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (request.headers.get("content-type")?.includes("application/json")) {
      const body = await request.json();
      if (!Array.isArray(body.files) || !body.files.length) throw new AssetError("At least one source file is required");
      const releaseId = body.releaseId || beginRelease(body.baseReleaseId !== undefined ? { baseReleaseId: body.baseReleaseId } : {});
      const allowed = releaseFileNames(releaseId);
      for (const file of body.files) {
        if (!file || !allowed.has(file.name) || typeof file.path !== "string") throw new AssetError("A tracked source name and path are required");
        await stageFile(releaseId, file.name, file.path);
      }
      return NextResponse.json({ releaseId, results: body.files.map((file: { name: string }) => ({ name: file.name, staged: true })) });
    }
    const upload = await stageMultipart(request);
    if (upload.fields.mode === "art") {
      if (!upload.expected.length || upload.keys.some((key) => !/^(custom-items|assets|reactors)\//.test(key))) {
        throw new AssetError("Art upload requires expected metadata and a generated-art key");
      }
      const result = await publishRelease(upload.releaseId, upload.expected);
      return NextResponse.json({ success: true, releaseId: result.releaseId, assets: result.assets });
    }
    const allowed = releaseFileNames(upload.releaseId);
    if (upload.keys.some((key) => !allowed.has(key))) throw new AssetError("Only files in the frozen release catalog may be staged here");
    return NextResponse.json({ releaseId: upload.releaseId, results: upload.keys.map((name) => ({ name, staged: true })) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: error instanceof AssetError ? error.status : 500 });
  }
}
