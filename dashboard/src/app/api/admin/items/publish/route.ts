import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { ASSET_DIR, AssetError, hashFileStream, lockPublicationJob, readManifest, resolveAssetPath, writePublicationStatus } from "@/lib/assets";
import type { SourceAsset } from "@/lib/assets";
import { publishWzFiles } from "@/lib/wz-to-nx";
import { restartGameServer } from "@/lib/game-control";
import { upsertServerStrings } from "@/lib/wz/server-strings";
import { resolveArtPath } from "@/lib/art";
import {
  parseWzFile,
  saveWzFile,
  addEquipToCharacterWz,
  addWeaponToCharacterWz,
  addStringsToStringWz,
  getSectionName,
  WEAPON_TYPES,
} from "@/lib/wz";
import type { WeaponData, WeaponFrame } from "@/lib/wz";
import { execSync } from "child_process";
import { randomUUID } from "crypto";
import {
  copyFileSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  existsSync,
  rmSync,
  statSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";

const STATUS_FILE = join(ASSET_DIR, "jobs", "publish-status.json");

// --- Status helpers ---

interface PublishStatus {
  id: string;
  status: "running" | "done" | "error";
  step: string;
  actions: string[];
  error?: string;
  startedAt: string;
  finishedAt?: string;
  items_published?: number;
  version?: string;
  releaseId?: string;
}

function writeStatus(s: PublishStatus) {
  writePublicationStatus("publish-status.json", s);
}

function readStatus(): PublishStatus | null {
  try {
    if (!existsSync(STATUS_FILE)) return null;
    return JSON.parse(readFileSync(STATUS_FILE, "utf-8"));
  } catch {
    return null;
  }
}

// --- Helpers ---

// --- WZ XML generation ---

const SUB_CATEGORY_DIRS: Record<string, string> = {
  Ring: "Character.wz/Ring",
  Pendant: "Character.wz/Accessory",
  Face: "Character.wz/Accessory",
  Eye: "Character.wz/Accessory",
  Earring: "Character.wz/Accessory",
  Belt: "Character.wz/Accessory",
  Medal: "Character.wz/Accessory",
  Cap: "Character.wz/Cap",
  Coat: "Character.wz/Coat",
  Longcoat: "Character.wz/Longcoat",
  Pants: "Character.wz/Pants",
  Shoes: "Character.wz/Shoes",
  Glove: "Character.wz/Glove",
  Shield: "Character.wz/Shield",
  Cape: "Character.wz/Cape",
  Weapon: "Character.wz/Weapon",
};

const STAT_FIELDS: Record<string, string> = {
  str: "incSTR",
  dex: "incDEX",
  int: "incINT",
  luk: "incLUK",
  hp: "incMHP",
  mp: "incMMP",
  watk: "incPAD",
  matk: "incMAD",
  wdef: "incPDD",
  mdef: "incMDD",
  acc: "incACC",
  avoid: "incEVA",
  speed: "incSpeed",
  jump: "incJump",
};

const STRING_SECTIONS: Record<string, string> = {
  Ring: "Ring",
  Pendant: "Accessory",
  Face: "Accessory",
  Eye: "Accessory",
  Earring: "Accessory",
  Belt: "Accessory",
  Medal: "Accessory",
  Cap: "Cap",
  Coat: "Top",
  Longcoat: "Overall",
  Pants: "Bottom",
  Shoes: "Shoes",
  Glove: "Glove",
  Shield: "Shield",
  Cape: "Cape",
  Weapon: "Weapon",
};

function padItemId(id: number): string {
  return String(id).padStart(8, "0");
}


function generateEquipXml(item: {
  item_id: number;
  sub_category: string;
  stats: Record<string, number>;
  requirements: Record<string, number>;
  flags: Record<string, boolean>;
}): string {
  const padded = padItemId(item.item_id);
  const stats = item.stats || {};
  const reqs = item.requirements || {};
  const flags = item.flags || {};

  const slotMap: Record<string, string> = {
    Ring: "Ri",
    Pendant: "Pe",
    Face: "Af",
    Eye: "Ae",
    Earring: "Ae",
    Belt: "Be",
    Medal: "Me",
    Cap: "Cp",
    Coat: "Ma",
    Longcoat: "Ma",
    Pants: "Pn",
    Shoes: "So",
    Glove: "Gv",
    Shield: "Si",
    Cape: "Sr",
    Weapon: "Wp",
  };
  const slot = slotMap[item.sub_category] || "Ri";

  let xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`;
  xml += `<imgdir name="${padded}.img">\n`;
  xml += `  <imgdir name="info">\n`;
  xml += `    <canvas name="icon" width="26" height="28">\n`;
  xml += `      <vector name="origin" x="-4" y="28"/>\n`;
  xml += `    </canvas>\n`;
  xml += `    <canvas name="iconRaw" width="24" height="26">\n`;
  xml += `      <vector name="origin" x="-4" y="28"/>\n`;
  xml += `    </canvas>\n`;
  xml += `    <string name="islot" value="${slot}"/>\n`;
  xml += `    <string name="vslot" value="${slot}"/>\n`;
  xml += `    <int name="reqJob" value="${reqs.job ?? 0}"/>\n`;
  xml += `    <int name="reqLevel" value="${reqs.level ?? 0}"/>\n`;
  xml += `    <int name="reqSTR" value="${reqs.str ?? 0}"/>\n`;
  xml += `    <int name="reqDEX" value="${reqs.dex ?? 0}"/>\n`;
  xml += `    <int name="reqINT" value="${reqs.int ?? 0}"/>\n`;
  xml += `    <int name="reqLUK" value="${reqs.luk ?? 0}"/>\n`;
  xml += `    <int name="cash" value="${flags.cash ? 1 : 0}"/>\n`;
  xml += `    <int name="slotMax" value="${stats.slots ?? 0}"/>\n`;
  if (stats.slots) xml += `    <int name="tuc" value="${stats.slots}"/>\n`;
  if (flags.tradeBlock) xml += `    <int name="tradeBlock" value="1"/>\n`;
  if (flags.only) xml += `    <int name="only" value="1"/>\n`;
  if (flags.notSale) xml += `    <int name="notSale" value="1"/>\n`;

  for (const [key, wzField] of Object.entries(STAT_FIELDS)) {
    if (stats[key] && stats[key] !== 0) {
      xml += `    <int name="${wzField}" value="${stats[key]}"/>\n`;
    }
  }

  if (item.sub_category === "Weapon") {
    const wt = (stats as any)._weaponType || "staff";
    const wtMeta = WEAPON_TYPES[wt] || WEAPON_TYPES.staff;
    xml += `    <int name="walk" value="${wtMeta.walk}"/>\n`;
    xml += `    <int name="stand" value="${wtMeta.stand}"/>\n`;
    xml += `    <short name="attack" value="${wtMeta.attack}"/>\n`;
    xml += `    <string name="afterImage" value="${wtMeta.afterImage}"/>\n`;
    xml += `    <string name="sfx" value="${wtMeta.sfx}"/>\n`;
    xml += `    <int name="attackSpeed" value="${(stats as any)._attackSpeed || 6}"/>\n`;
  }

  xml += `  </imgdir>\n`;
  xml += `</imgdir>\n`;
  return xml;
}

function writeEquipXml(
  wzRoot: string,
  item: {
    item_id: number;
    sub_category: string;
    stats: Record<string, number>;
    requirements: Record<string, number>;
    flags: Record<string, boolean>;
  }
): string {
  const dir = SUB_CATEGORY_DIRS[item.sub_category] || "Character.wz/Ring";
  const fullDir = join(wzRoot, dir);
  if (!existsSync(fullDir)) mkdirSync(fullDir, { recursive: true });

  const filename = `${padItemId(item.item_id)}.img.xml`;
  const filePath = join(fullDir, filename);
  const xml = generateEquipXml(item);
  writeFileSync(filePath, xml, "utf-8");
  return filePath;
}


// --- Background publish job ---

async function runPublishJob(jobId: string) {
  const workDir = join(tmpdir(), `publish-${jobId}`);
  const status: PublishStatus = {
    id: jobId,
    status: "running",
    step: "Starting...",
    actions: [],
    startedAt: new Date().toISOString(),
  };

  function update(step: string, action?: string) {
    status.step = step;
    if (action) status.actions.push(action);
    writeStatus(status);
  }

  try {
    const baseReleaseId = readManifest().manifest.releaseId ?? null;
    const files: SourceAsset[] = [];
    // 1. Fetch custom equip items from DB
    update("Fetching custom items from database...");
    const rows = await query(
      "SELECT * FROM custom_items WHERE category = 'equip' ORDER BY item_id"
    );
    const items = (rows as any[]).map((r) => ({
      item_id: r.item_id,
      name: r.name,
      description: r.description || "",
      sub_category: r.sub_category || "Ring",
      icon_url: r.icon_url || null,
      stats:
        typeof r.stats === "string" ? JSON.parse(r.stats) : r.stats || {},
      requirements:
        typeof r.requirements === "string"
          ? JSON.parse(r.requirements)
          : r.requirements || {},
      flags:
        typeof r.flags === "string" ? JSON.parse(r.flags) : r.flags || {},
    }));

    if (items.length === 0) {
      status.status = "error";
      status.error = "No custom equip items to publish";
      status.finishedAt = new Date().toISOString();
      writeStatus(status);
      return;
    }
    update("Fetched items", `Found ${items.length} custom equip item(s)`);

    // Read the committed server baseline; all edits remain in this candidate.
    update("Loading server WZ files...");
    mkdirSync(workDir, { recursive: true });
    const tarPath = join(workDir, "server-wz.tar.gz");
    copyFileSync(resolveAssetPath("server-wz.tar.gz"), tarPath);
    update(
      "Loaded server WZ",
      `Loaded server-wz.tar.gz (${(statSync(tarPath).size / 1024 / 1024).toFixed(1)}MB)`
    );

    // 3. Extract
    update("Extracting WZ files...");
    execSync(`tar xzf "${tarPath}" -C "${workDir}"`, { timeout: 300000 });
    update("Extracted", "Extracted WZ files");

    const wzRoot = join(workDir, "wz");
    if (!existsSync(wzRoot)) {
      throw new Error("Extracted tar does not contain wz/ directory");
    }

    // 4. Generate and inject XML for each item
    update("Generating server XML...");
    for (const item of items) {
      const xmlPath = writeEquipXml(wzRoot, item);
      update(
        `Writing ${item.name}...`,
        `Wrote ${item.name} (${item.item_id}) → ${xmlPath.replace(workDir + "/", "")}`
      );
    }

    // 5. Update String.wz/Eqp.img.xml with names
    update("Updating item names...");
    upsertServerStrings(join(wzRoot, "String.wz", "Eqp.img.xml"), "Eqp.img", items.map((item) => ({
      section: ["Eqp", STRING_SECTIONS[item.sub_category] || "Accessory"],
      id: String(item.item_id),
      fields: [{ name: "name", value: item.name }, { name: "desc", value: item.description }],
    })));
    update("Updated names", "Updated String.wz/Eqp.img.xml with item names");

    // 6. Repack tar
    update("Repacking server WZ...");
    const newTarPath = join(workDir, "server-wz-new.tar.gz");
    const packDirs = existsSync(join(workDir, "scripts")) ? "wz/ scripts/" : "wz/";
    execSync(
      `cd "${workDir}" && COPYFILE_DISABLE=1 tar czf "${newTarPath}" --exclude='.DS_Store' --exclude='._*' ${packDirs}`,
      { timeout: 300000 }
    );
    const tarExpectation = await hashFileStream(newTarPath);
    update(
      "Repacked",
      `Repacked server-wz.tar.gz (${(tarExpectation.size / 1024 / 1024).toFixed(1)}MB)`
    );

    files.push({ key: "server-wz.tar.gz", path: newTarPath, ...tarExpectation });
    // Build every native candidate before asking the common transaction to
    // prepare NX and commit the complete release.
      update("Loading Character.wz (~200MB)...");
      const charWzPath = join(workDir, "Character.wz");
      copyFileSync(resolveAssetPath("Character.wz"), charWzPath);
      update(
        "Loaded Character.wz",
        `Loaded Character.wz (${(statSync(charWzPath).size / 1024 / 1024).toFixed(0)}MB)`
      );

      update("Patching Character.wz...");
      const charWz = parseWzFile(charWzPath);
      for (const item of items) {
        let iconPng: Buffer | undefined;
        if (item.icon_url) {
          iconPng = readFileSync(resolveArtPath(item.icon_url));
        }

        if (item.sub_category === "Weapon" && item.stats._weaponFrames) {
          try {
            const wfData = item.stats._weaponFrames as {
              origins: Record<string, Array<{ gripX?: number; gripY?: number; x?: number; y?: number }>>;
              frames: Record<string, string[]>;
            };
            const wt = item.stats._weaponType || "staff";
            const wtMeta = WEAPON_TYPES[wt] || WEAPON_TYPES.staff;

            const animations: Record<string, WeaponFrame[]> = {};
            for (const [animName, frameUrls] of Object.entries(wfData.frames)) {
              const originList = wfData.origins[animName] || [];
              animations[animName] = [];
              for (let fi = 0; fi < frameUrls.length; fi++) {
                try {
                  const pngBuf = readFileSync(resolveArtPath(frameUrls[fi]));
                  const orig = originList[fi] || { gripX: 0, gripY: 0 };
                  const gripX = orig.gripX ?? orig.x ?? 0;
                  const gripY = orig.gripY ?? orig.y ?? 0;
                  const isAttack = animName.startsWith("swing") || animName.startsWith("stab") || animName.startsWith("shoot") || animName === "proneStab";
                  animations[animName].push({
                    pngBuf,
                    originX: gripX,
                    originY: gripY,
                    attachX: 0,
                    attachY: 0,
                    attachType: isAttack ? "navel" : "hand",
                    z: isAttack ? "weaponBelowBody" : "weapon",
                  });
                } catch (err) {
                  throw err;
                }
              }
            }

            const weaponData: WeaponData = {
              itemId: item.item_id,
              weaponType: wt,
              attackSpeed: item.stats._attackSpeed || 6,
              afterImage: wtMeta.afterImage,
              sfx: wtMeta.sfx,
              stats: item.stats,
              requirements: item.requirements,
              flags: item.flags,
              iconPng,
              animations,
            };
            addWeaponToCharacterWz(charWz, weaponData);
            update(
              `Added weapon ${item.name}`,
              `Added weapon ${item.name} with ${Object.values(animations).flat().length} frames`
            );
          } catch (err: any) {
            throw err;
          }
        } else {
          addEquipToCharacterWz(charWz, {
            itemId: item.item_id,
            subCategory: item.sub_category,
            stats: item.stats,
            requirements: item.requirements,
            flags: item.flags,
            iconPng,
          });
        }
      }

      update("Saving patched Character.wz...");
      const charWzOut = join(workDir, "Character-patched.wz");
      saveWzFile(charWz, charWzOut);
      update("Patched", "Patched Character.wz with custom items");

      files.push({ key: "Character.wz", path: charWzOut, ...await hashFileStream(charWzOut) });

      // 9b. Copy and patch String.wz from the asset dir
      update("Loading String.wz...");
      const strWzPath = join(workDir, "String.wz");
      copyFileSync(resolveAssetPath("String.wz"), strWzPath);

      const strWz = parseWzFile(strWzPath);
      addStringsToStringWz(
        strWz,
        items.map((item) => ({
          itemId: item.item_id,
          name: item.name,
          desc: item.description,
          sectionName: getSectionName(item.sub_category),
        }))
      );
      const strWzOut = join(workDir, "String-patched.wz");
      saveWzFile(strWz, strWzOut);
      update("Patched String.wz", "Patched String.wz with item names");

      files.push({ key: "String.wz", path: strWzOut, ...await hashFileStream(strWzOut) });
    const released = await publishWzFiles(files, items.flatMap((item) => [
      {
        op: "import_image" as const,
        target_wz: "Character.wz",
        target_image: `${(SUB_CATEGORY_DIRS[item.sub_category] || SUB_CATEGORY_DIRS.Ring).replace("Character.wz/", "")}/${padItemId(item.item_id)}.img`,
      },
      {
        op: "set_subtree" as const,
        target_wz: "String.wz",
        target_image: "Eqp.img",
        target_node: `Eqp/${getSectionName(item.sub_category)}/${item.item_id}`,
      },
    ]), { baseReleaseId });
    status.releaseId = released.releaseId;
    status.version = released.manifest.version;
    update("Applying server release", `Committed release ${released.releaseId}; applying server WZ`);
    const applied = await restartGameServer();
    if (!applied.success) throw new Error(applied.error || "Server apply failed");
    update("Server applied", `Applied release ${released.releaseId}`);

    // 11. Cleanup
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {}

    status.status = "done";
    status.step = "Complete";
    status.finishedAt = new Date().toISOString();
    status.items_published = items.length;
    status.version = released.manifest.version;
    writeStatus(status);
  } catch (err: any) {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {}
    status.status = "error";
    status.error = err.message;
    status.step = "Failed";
    status.finishedAt = new Date().toISOString();
    writeStatus(status);
  }
}

// --- Endpoints ---

// POST: Start a publish job (returns immediately)
export async function POST() {
  const jobId = randomUUID().slice(0, 8);
  let unlock: (() => void) | undefined;
  try {
    unlock = await lockPublicationJob("publish-status.json");
    writeStatus({ id: jobId, status: "running", step: "Starting...", actions: [], startedAt: new Date().toISOString() });
  } catch (error) {
    unlock?.();
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: error instanceof AssetError ? error.status : 500 });
  }

  // Fire and forget — don't await
  runPublishJob(jobId).catch((err) => {
    console.error("Publish job crashed:", err);
  }).finally(unlock);

  return NextResponse.json({ started: true, id: jobId });
}

// GET: Poll publish status
export async function GET() {
  const status = readStatus();
  if (!status) {
    return NextResponse.json({ status: "idle" });
  }
  return NextResponse.json(status);
}
