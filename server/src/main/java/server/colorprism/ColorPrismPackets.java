package server.colorprism;

import client.Character;
import client.Client;
import client.ClientCaps;
import client.inventory.Equip;
import client.inventory.InventoryType;
import client.inventory.Item;
import net.opcodes.SendOpcode;
import net.packet.OutPacket;
import net.packet.Packet;
import server.maps.MapleMap;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/*
 * Coloring prism (ticket #11) — server-to-client packets (LP 0x372F).
 *
 * The one opcode carries a snapshot: every tint key this character owns, so the
 * DLL-side window (DLL-first policy: coloringprism.cpp/weapontint.cpp, not built here)
 * has something to recolour with. Field order is AUTHORITATIVE for the DLL half;
 * change both sides or neither.
 *
 * Keys: equip body = itemId, equip effect art = itemId + 10000000, cash effect item
 * (5010000..5019999) = itemId + 10000000 (it IS the effect, no body half), skill
 * = skillId + 30000000, hair/face/skin = negative sentinel keys below. All zero
 * (identity) entries are omitted — never dyed and dyed-back are one state.
 */
public final class ColorPrismPackets {

    /** Send-opcode alias: WEAPON_TINT_SYNC is the dump-side name for the same value. */
    public static final int WEAPON_TINT_SYNC_ALIAS = 0x372F;

    // server -> client (LP 0x372F)
    public static final int RESP_SNAPSHOT = 0;

    // Look-tint keys. Negative so they can never collide with an item or skill key.
    public static final int KEY_HAIR = -1;
    public static final int KEY_FACE = -2;
    public static final int KEY_SKIN = -3;

    /** Effect-art key offset for an equip's glow layer (flame chip on the Items tab). */
    public static final int EFFECT_KEY_OFFSET = 10000000;

    /** Skill-tint key offset (a skill has no inventory row to carry its colour). */
    public static final int SKILL_KEY_OFFSET = 30000000;

    private ColorPrismPackets() {
    }

    /**
     * Full tint table for one character: key, hue(short), chroma(byte), bright(byte)
     * per entry, prefixed by the character id and entry count.
     */
    public static Packet snapshot(Character chr) {
        List<int[]> entries = collectEntries(chr);
        OutPacket p = OutPacket.create(SendOpcode.COLORING_PRISM_SYNC);
        p.writeByte(RESP_SNAPSHOT);
        p.writeInt(chr.getId());
        p.writeShort(entries.size());
        for (int[] e : entries) {
            p.writeInt(e[0]);
            p.writeShort(e[1]);
            p.writeByte(e[2]);
            p.writeByte(e[3]);
        }
        return p;
    }

    /** The palette belongs to subject; only the receiving connection needs PRISM_SYNC. */
    public static void sendSnapshot(Character subject, Client recipient) {
        if (recipient != null && recipient.hasCaps(ClientCaps.PRISM_SYNC)) {
            recipient.sendPacket(snapshot(subject));
        }
    }

    /** Includes empty palettes so observers discard an owner's restored tint. */
    public static void broadcastSnapshot(Character subject) {
        Packet packet = null;
        Client owner = subject.getClient();
        if (owner != null && owner.hasCaps(ClientCaps.PRISM_SYNC)) {
            packet = snapshot(subject);
            owner.sendPacket(packet);
        }
        MapleMap map = subject.getMap();
        if (map == null) {
            return;
        }
        for (Character observer : map.getAllPlayers()) {
            if (observer == subject) {
                continue;
            }
            Client recipient = observer.getClient();
            if (recipient != null && recipient.hasCaps(ClientCaps.PRISM_SYNC)) {
                if (packet == null) {
                    packet = snapshot(subject);
                }
                recipient.sendPacket(packet);
            }
        }
    }

    /** Exchange the arrival's palette and existing actors' palettes in both directions. */
    public static void onMapEntry(Character arrival) {
        MapleMap map = arrival.getMap();
        if (map == null) {
            return;
        }
        Client arrivingClient = arrival.getClient();
        Packet arrivalPacket = null;
        for (Character existing : map.getAllPlayers()) {
            if (existing != arrival) {
                sendSnapshot(existing, arrivingClient);
            }
            Client recipient = existing.getClient();
            if (recipient != null && recipient.hasCaps(ClientCaps.PRISM_SYNC)) {
                if (arrivalPacket == null) {
                    arrivalPacket = snapshot(arrival);
                }
                recipient.sendPacket(arrivalPacket);
            }
        }
    }

    static List<int[]> collectEntries(Character chr) {
        List<int[]> entries = new ArrayList<>();
        for (Item item : chr.getInventory(InventoryType.EQUIPPED).list()) {
            if (!(item instanceof Equip equip)) {
                continue;
            }
            if (equip.isTinted()) {
                entries.add(new int[]{equip.getItemId(), equip.getTintHue(), equip.getTintChroma(), equip.getTintBright()});
            }
            if (equip.isFxTinted()) {
                entries.add(new int[]{equip.getItemId() + EFFECT_KEY_OFFSET,
                        equip.getTintFxHue(), equip.getTintFxChroma(), equip.getTintFxBright()});
            }
        }
        for (Item item : chr.getInventory(InventoryType.CASH).list()) {
            if (item instanceof Equip) {
                continue;
            }
            if (item.getItemId() < 5010000 || item.getItemId() > 5019999) {
                continue;
            }
            if (item.isEffTinted()) {
                entries.add(new int[]{item.getItemId() + EFFECT_KEY_OFFSET,
                        item.getEffTintHue(), item.getEffTintChroma(), item.getEffTintBright()});
            }
        }
        if (chr.isHairTinted()) {
            entries.add(new int[]{KEY_HAIR, chr.getHairTintHue(), chr.getHairTintChroma(), chr.getHairTintBright()});
        }
        if (chr.isFaceTinted()) {
            entries.add(new int[]{KEY_FACE, chr.getFaceTintHue(), chr.getFaceTintChroma(), chr.getFaceTintBright()});
        }
        if (chr.isSkinTinted()) {
            entries.add(new int[]{KEY_SKIN, chr.getSkinTintHue(), chr.getSkinTintChroma(), chr.getSkinTintBright()});
        }
        for (Map.Entry<Integer, int[]> e : chr.getSkillTints().entrySet()) {
            int[] t = e.getValue();
            if (t[0] != 0 || t[1] != 0 || t[2] != 0) {
                entries.add(new int[]{e.getKey() + SKILL_KEY_OFFSET, t[0], t[1], t[2]});
            }
        }
        return entries;
    }
}
