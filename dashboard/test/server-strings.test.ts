import { test, expect } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DOMParser } from "@xmldom/xmldom";
import { PNG } from "pngjs";
import { upsertServerStrings } from "../src/lib/wz/server-strings";
import { buildEtcBucketImg, parseImgBytes } from "../src/lib/wz/patcher";

test("compact nested equip strings update exact IDs without indentation assumptions or sibling loss", () => {
  const directory = mkdtempSync(join(tmpdir(), "server-strings-"));
  const path = join(directory, "Eqp.img.xml");
  try {
    writeFileSync(path, '<?xml version="1.0"?><imgdir name="Eqp.img"><imgdir name="Eqp"><imgdir name="Ring"><imgdir name="1112000"><string name="name" value="Untouched"/></imgdir><imgdir name="1112999"><string name="name" value="Old"/></imgdir></imgdir><imgdir name="Cap"><imgdir name="1112999"><string name="name" value="Same ID, other section"/></imgdir></imgdir></imgdir></imgdir>');
    upsertServerStrings(path, "Eqp.img", [{ section: ["Eqp", "Ring"], id: "1112999", fields: [{ name: "name", value: 'New & "quoted" ring' }, { name: "desc", value: "<safe>" }] }]);
    const document = new DOMParser().parseFromString(readFileSync(path, "utf8"), "text/xml");
    const fields = Array.from(document.getElementsByTagName("string")).map((field) => field.getAttribute("value"));
    expect(fields).toContain("Untouched"); expect(fields).toContain("Same ID, other section");
    expect(fields).toContain('New & "quoted" ring'); expect(fields).toContain("<safe>"); expect(fields).not.toContain("Old");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("compact ETC updates batch entries and missing section leaves the original candidate file untouched", () => {
  const directory = mkdtempSync(join(tmpdir(), "server-strings-"));
  const path = join(directory, "Etc.img.xml");
  try {
    writeFileSync(path, '<imgdir name="Etc.img"><imgdir name="Etc"><imgdir name="4000000"><string name="name" value="Stock"/></imgdir></imgdir></imgdir>');
    upsertServerStrings(path, "Etc.img", [1, 2].map((id) => ({ section: ["Etc"], id: String(4090000 + id), fields: [{ name: "name", value: `Token ${id}` }] })));
    const before = readFileSync(path, "utf8");
    expect(before).toContain("Stock"); expect(before).toContain("Token 1"); expect(before).toContain("Token 2");
    expect(() => upsertServerStrings(path, "Etc.img", [{ section: ["Missing"], id: "3", fields: [] }])).toThrow(/Missing/);
    expect(readFileSync(path, "utf8")).toBe(before);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("generated ETC binary keys match the eight-digit Java/native item lookup", () => {
  const keyStream = Buffer.alloc(65536);
  const ids = [4090001, 4099999];
  const image = new PNG({ width: 2, height: 2 }); image.data.fill(255);
  const iconPng = PNG.sync.write(image);
  const decoded = parseImgBytes(buildEtcBucketImg(ids.map((itemId) => ({ itemId, slotMax: 100, iconPng })), keyStream), keyStream);
  for (const id of ids) {
    const item = decoded.children?.find((child) => child.name === `0${id}`);
    expect(item?.children?.find((child) => child.name === "info")?.children?.find((child) => child.name === "slotMax")?.value).toBe(100);
    const info = item?.children?.find((child) => child.name === "info");
    expect(info?.children?.find((child) => child.name === "icon")?.rawBytes?.length).toBeGreaterThan(0);
    expect(info?.children?.find((child) => child.name === "iconRaw")?.rawBytes?.length).toBeGreaterThan(0);
    expect(decoded.children?.some((child) => child.name === String(id))).toBe(false);
  }
});
