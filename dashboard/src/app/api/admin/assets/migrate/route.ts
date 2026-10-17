import { NextRequest, NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { isAbsolute } from "path";
import { getPool } from "@/lib/db";
import { AssetError, publishFiles, type SourceAsset } from "@/lib/assets";

export const dynamic = "force-dynamic";

type RecordKind = "item" | "reactor" | "generation" | "asset";
interface Reference { kind: RecordKind; id: number; urls: { from: string; key: string }[] }
interface MigrationInput { files: SourceAsset[]; records: Reference[] }
const TABLES: Record<RecordKind, { table: string; id: string; fields: string[] }> = {
  item: { table: "custom_items", id: "id", fields: ["icon_url", "stats"] },
  reactor: { table: "custom_reactors", id: "id", fields: ["idle_png_url"] },
  generation: { table: "gm_generated_items", id: "id", fields: ["concept_image_url", "glb_url"] },
  asset: { table: "custom_assets", id: "id", fields: ["file_key", "preview_url"] },
};

function parseInput(input: unknown): MigrationInput {
  if (!input || typeof input !== "object" || !("files" in input) || !Array.isArray(input.files) || input.files.length === 0) throw new Error("files must contain explicit local sources and expected metadata");
  const keys = new Set<string>();
  const files = input.files.map((file: unknown): SourceAsset => {
    if (!file || typeof file !== "object" || !("key" in file) || typeof file.key !== "string"
      || !/^(custom-items|reactors|assets|candidates)\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(file.key)
      || file.key.split("/").some((segment) => segment === "." || segment === "..")
      || !("path" in file) || typeof file.path !== "string" || !isAbsolute(file.path)
      || !("hash" in file) || typeof file.hash !== "string" || !/^[a-f0-9]{64}$/.test(file.hash)
      || !("size" in file) || typeof file.size !== "number" || !Number.isSafeInteger(file.size) || file.size < 0) throw new Error("Each art file requires a safe namespaced key, absolute local path, expected SHA-256 and size");
    if (keys.has(file.key)) throw new Error("Duplicate art key");
    keys.add(file.key);
    return { key: file.key, path: file.path, hash: file.hash, size: file.size };
  });
  if (!("records" in input) || !Array.isArray(input.records)) throw new Error("records must explicitly select persisted references (or [] for import only)");
  const records = input.records.map((record: unknown): Reference => {
    if (!record || typeof record !== "object" || !("kind" in record) || typeof record.kind !== "string" || !Object.hasOwn(TABLES, record.kind)
      || !("id" in record) || typeof record.id !== "number" || !Number.isSafeInteger(record.id) || record.id <= 0
      || !("urls" in record) || !Array.isArray(record.urls) || record.urls.length === 0) throw new Error("Each record requires kind, positive database row id and exact old URL mappings");
    const urls = record.urls.map((url: unknown) => {
      if (!url || typeof url !== "object" || !("from" in url) || typeof url.from !== "string" || !url.from
        || !("key" in url) || typeof url.key !== "string" || !keys.has(url.key)) throw new Error("Each mapping requires exact from URL and imported key");
      return { from: url.from, key: url.key };
    });
    return { kind: record.kind as RecordKind, id: record.id, urls };
  });
  return { files, records };
}

function replaceReferences(value: unknown, from: string, to: string): { value: unknown; count: number } {
  if (value === from) return { value: to, count: 1 };
  if (!value || typeof value !== "object") return { value, count: 0 };
  let count = 0;
  const replace = (entry: unknown) => {
    const result = replaceReferences(entry, from, to);
    count += result.count;
    return result.value;
  };
  const replaced = Array.isArray(value) ? value.map(replace) : Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, replace(entry)]));
  return { value: replaced, count };
}

/** Private, operator-directed import. Never fetches an old R2 URL or decodes data URL fallbacks. */
export async function POST(request: NextRequest) {
  let input: MigrationInput;
  try { input = parseInput(await request.json()); }
  catch (err) { return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 }); }
  let publication;
  try { publication = await publishFiles(input.files); }
  catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: error instanceof AssetError ? error.status : 500 });
  }
  if (input.records.length === 0) return NextResponse.json({ ...publication, migrated: 0 });
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    for (const record of input.records) {
      const spec = TABLES[record.kind];
      const [rows] = await connection.execute<RowDataPacket[]>(`SELECT ${spec.fields.join(", ")} FROM ${spec.table} WHERE ${spec.id} = ? FOR UPDATE`, [record.id]);
      if (rows.length !== 1) throw new Error(`${record.kind} row ${record.id} not found`);
      const values: Record<string, unknown> = {};
      for (const field of spec.fields) {
        const value: unknown = rows[0][field];
        values[field] = field === "stats" && typeof value === "string" ? JSON.parse(value) : value;
      }
      for (const mapping of record.urls) {
        const asset = publication.assets.find((asset) => asset.key === mapping.key)!;
        let count = 0;
        for (const field of spec.fields) {
          const result = replaceReferences(values[field], mapping.from, field === "file_key" ? asset.key : asset.url);
          values[field] = result.value;
          count += result.count;
        }
        if (count === 0) throw new Error(`Old reference not found in ${record.kind} row ${record.id}; no records changed`);
        if (record.kind === "asset" && values.file_key === asset.key) {
          values.file_hash = asset.hash;
          values.file_size = asset.size;
          if (asset.key.endsWith(".png")) values.preview_url = asset.url;
        }
      }
      const fields = Object.keys(values);
      const parameters: Array<string | number | boolean | null> = fields.map((field) => {
        const value = values[field];
        if (value == null) return null;
        if (field === "stats") return JSON.stringify(value);
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
        throw new Error(`Unsupported persisted value for ${field}`);
      });
      parameters.push(record.id);
      const [result] = await connection.execute<ResultSetHeader>(`UPDATE ${spec.table} SET ${fields.map((field) => `${field} = ?`).join(", ")} WHERE ${spec.id} = ?`, parameters);
      if (result.affectedRows !== 1) throw new Error(`Could not migrate ${record.kind} row ${record.id}`);
    }
    await connection.commit();
    return NextResponse.json({ releaseId: publication.releaseId, assets: publication.assets, migrated: input.records.length });
  } catch (err) {
    await connection.rollback();
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err), releaseId: publication.releaseId, assets: publication.assets, migrated: 0 }, { status: 409 });
  } finally { connection.release(); }
}
