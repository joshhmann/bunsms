package net.server.channel.handlers;

import client.Character;
import client.Client;
import client.inventory.Equip;
import client.inventory.Inventory;
import client.inventory.InventoryType;
import client.inventory.Item;
import client.inventory.manipulator.InventoryManipulator;
import constants.id.ItemId;
import net.AbstractPacketHandler;
import net.packet.InPacket;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import server.colorprism.ColorPrismPackets;

/*
 * Coloring prism (ticket #11) — client-to-server handler (CP 0x372E).
 * WEAPON_TINT_ACTION is the dump-side alias for the same opcode; the canonical
 * name here is COLORING_PRISM_ACTION (registry records the alias).
 *
 * The one opcode carries seven actions, switched on the first byte:
 *   0 request      -> resend every tint this character owns
 *   1 apply        -> invType(1) invPos(2) itemId(4) hue(2) chroma(1) bright(1) prismPos(2) layer(1)
 *   2 restore      -> invType(1) invPos(2) itemId(4) prismPos(2) layer(1)
 *   3 applyLook    -> kind(1) hue(2) chroma(1) bright(1) prismPos(2)
 *   4 restoreLook  -> kind(1) prismPos(2)
 *   5 applySkill   -> skillId(4) hue(2) chroma(1) bright(1) prismPos(2)
 *   6 restoreSkill -> skillId(4) prismPos(2)
 *
 * layer 0 = body, 1 = effect art. kind 0 = hair, 1 = face, 2 = skin.
 * Deliberately NO isCash gate (per dump README): ordinary equips dye like cash ones,
 * and the DLL drop gate matches. Identity tint is a RESTORE, so the server refuses
 * without consuming anything when the target was never dyed.
 */
public final class WeaponTintHandler extends AbstractPacketHandler {

    private static final Logger log = LoggerFactory.getLogger(WeaponTintHandler.class);

    /** Recv-opcode alias: WEAPON_TINT_ACTION is the dump-side name for 0x372E. */
    public static final int WEAPON_TINT_ACTION_ALIAS = 0x372E;

    public static final int ACTION_REQUEST = 0;
    public static final int ACTION_APPLY = 1;
    public static final int ACTION_RESTORE = 2;
    public static final int ACTION_APPLY_LOOK = 3;
    public static final int ACTION_RESTORE_LOOK = 4;
    public static final int ACTION_APPLY_SKILL = 5;
    public static final int ACTION_RESTORE_SKILL = 6;

    public static final int LAYER_BODY = 0;
    public static final int LAYER_EFFECT = 1;

    public static final int LOOK_HAIR = 0;
    public static final int LOOK_FACE = 1;
    public static final int LOOK_SKIN = 2;

    @Override
    public final void handlePacket(InPacket p, Client c) {
        Character chr = c.getPlayer();
        if (chr == null) {
            return;
        }
        if (p.available() < 1) {
            return;
        }
        int action = p.readByte();
        switch (action) {
            case ACTION_REQUEST -> ColorPrismPackets.sendSnapshot(chr, c);
            case ACTION_APPLY -> handleApply(p, c, chr);
            case ACTION_RESTORE -> handleRestore(p, c, chr);
            case ACTION_APPLY_LOOK -> handleApplyLook(p, c, chr);
            case ACTION_RESTORE_LOOK -> handleRestoreLook(p, c, chr);
            case ACTION_APPLY_SKILL -> handleApplySkill(p, c, chr);
            case ACTION_RESTORE_SKILL -> handleRestoreSkill(p, c, chr);
            default -> log.debug("[Prism] {} sent unknown tint action {}", chr.getName(), action);
        }
    }

    private void handleApply(InPacket p, Client c, Character chr) {
        // 1 + 2 + 4 + 2 + 1 + 1 + 2 + 1 = 14 bytes after the action byte.
        if (p.available() < 14) {
            return;
        }
        int invType = p.readByte();
        short invPos = p.readShort();
        int itemId = p.readInt();
        short hue = p.readShort();
        byte chroma = p.readByte();
        byte bright = p.readByte();
        short prismPos = p.readShort();
        int layer = p.readByte();

        if (!isValidTint(hue, chroma, bright)) {
            chr.dropMessage(1, "That colour is out of range.");
            return;
        }
        boolean identity = hue == 0 && chroma == 0 && bright == 0;
        InventoryType type = InventoryType.getByType((byte) invType);
        if (type == null) {
            return;
        }
        Inventory inv = chr.getInventory(type);
        Item target = inv.getItem(invPos);
        if (target == null || target.getItemId() != itemId) {
            return;
        }
        if (layer != LAYER_BODY && layer != LAYER_EFFECT) {
            return;
        }
        if (target instanceof Equip equip) {
            boolean wasTinted = layer == LAYER_BODY ? equip.isTinted() : equip.isFxTinted();
            if (identity && !wasTinted) {
                return; // RESTORE on a never-dyed target: refuse without consuming.
            }
            if (!consumePrism(c, chr, prismPos)) {
                return;
            }
            if (identity) {
                if (layer == LAYER_BODY) {
                    equip.clearTint();
                } else {
                    equip.clearFxTint();
                }
            } else if (layer == LAYER_BODY) {
                equip.setTint(hue, chroma, bright);
            } else {
                equip.setFxTint(hue, chroma, bright);
            }
        } else {
            if (!isCashEffectItem(target.getItemId())) {
                return;
            }
            if (layer != LAYER_EFFECT) {
                return;
            }
            if (identity && !target.isEffTinted()) {
                return;
            }
            if (!consumePrism(c, chr, prismPos)) {
                return;
            }
            if (identity) {
                target.clearEffTint();
            } else {
                target.setEffTint(hue, chroma, bright);
            }
        }
        chr.syncWeaponTint();
    }

    private void handleRestore(InPacket p, Client c, Character chr) {
        // 1 + 2 + 4 + 2 + 1 = 10 bytes after the action byte.
        if (p.available() < 10) {
            return;
        }
        int invType = p.readByte();
        short invPos = p.readShort();
        int itemId = p.readInt();
        short prismPos = p.readShort();
        int layer = p.readByte();

        InventoryType type = InventoryType.getByType((byte) invType);
        if (type == null) {
            return;
        }
        Item target = chr.getInventory(type).getItem(invPos);
        if (target == null || target.getItemId() != itemId) {
            return;
        }
        boolean wasTinted;
        if (target instanceof Equip equip) {
            wasTinted = layer == LAYER_BODY ? equip.isTinted() : equip.isFxTinted();
        } else if (isCashEffectItem(target.getItemId()) && layer == LAYER_EFFECT) {
            wasTinted = target.isEffTinted();
        } else {
            return;
        }
        if (!wasTinted) {
            return; // never dyed: refuse without consuming.
        }
        if (!consumePrism(c, chr, prismPos)) {
            return;
        }
        if (target instanceof Equip equip) {
            if (layer == LAYER_BODY) {
                equip.clearTint();
            } else {
                equip.clearFxTint();
            }
        } else {
            target.clearEffTint();
        }
        chr.syncWeaponTint();
    }

    private void handleApplyLook(InPacket p, Client c, Character chr) {
        // 1 + 2 + 1 + 1 + 2 = 7 bytes after the action byte.
        if (p.available() < 7) {
            return;
        }
        int kind = p.readByte();
        short hue = p.readShort();
        byte chroma = p.readByte();
        byte bright = p.readByte();
        short prismPos = p.readShort();

        if (!isValidTint(hue, chroma, bright)) {
            chr.dropMessage(1, "That colour is out of range.");
            return;
        }
        if (kind != LOOK_HAIR && kind != LOOK_FACE && kind != LOOK_SKIN) {
            return;
        }
        boolean identity = hue == 0 && chroma == 0 && bright == 0;
        boolean wasTinted = isLookTinted(chr, kind);
        if (identity && !wasTinted) {
            return;
        }
        if (!consumePrism(c, chr, prismPos)) {
            return;
        }
        setLookTint(chr, kind, hue, chroma, bright, identity);
        chr.syncWeaponTint();
    }

    private void handleRestoreLook(InPacket p, Client c, Character chr) {
        // 1 + 2 = 3 bytes after the action byte.
        if (p.available() < 3) {
            return;
        }
        int kind = p.readByte();
        short prismPos = p.readShort();

        if (kind != LOOK_HAIR && kind != LOOK_FACE && kind != LOOK_SKIN) {
            return;
        }
        if (!isLookTinted(chr, kind)) {
            return;
        }
        if (!consumePrism(c, chr, prismPos)) {
            return;
        }
        setLookTint(chr, kind, 0, 0, 0, true);
        chr.syncWeaponTint();
    }

    private void handleApplySkill(InPacket p, Client c, Character chr) {
        // 4 + 2 + 1 + 1 + 2 = 10 bytes after the action byte.
        if (p.available() < 10) {
            return;
        }
        int skillId = p.readInt();
        short hue = p.readShort();
        byte chroma = p.readByte();
        byte bright = p.readByte();
        short prismPos = p.readShort();

        if (!isValidTint(hue, chroma, bright)) {
            chr.dropMessage(1, "That colour is out of range.");
            return;
        }
        if (chr.getSkillLevel(skillId) <= 0) {
            return; // skills have no inventory row; knowing the skill is the only validation.
        }
        boolean identity = hue == 0 && chroma == 0 && bright == 0;
        if (identity && !chr.isSkillTinted(skillId)) {
            return;
        }
        if (!consumePrism(c, chr, prismPos)) {
            return;
        }
        chr.setSkillTint(skillId, hue, chroma, bright);
        chr.syncWeaponTint();
    }

    private void handleRestoreSkill(InPacket p, Client c, Character chr) {
        // 4 + 2 = 6 bytes after the action byte.
        if (p.available() < 6) {
            return;
        }
        int skillId = p.readInt();
        short prismPos = p.readShort();

        if (!chr.isSkillTinted(skillId)) {
            return;
        }
        if (!consumePrism(c, chr, prismPos)) {
            return;
        }
        chr.clearSkillTint(skillId);
        chr.syncWeaponTint();
    }

    /** Consumes one prism from the CASH tab at the client-named slot. False = refused. */
    private boolean consumePrism(Client c, Character chr, short prismPos) {
        Inventory cash = chr.getInventory(InventoryType.CASH);
        Item prism = cash.getItem(prismPos);
        if (prism == null || prism.getItemId() != ItemId.COLORING_PRISM) {
            chr.dropMessage(1, "You need a Coloring Prism to do that.");
            return false;
        }
        InventoryManipulator.removeFromSlot(c, InventoryType.CASH, prismPos, (short) 1, false, false);
        return true;
    }

    static boolean isValidTint(int hue, int chroma, int bright) {
        boolean hueOk = (hue >= 1 && hue <= 359) || (hue >= -360 && hue <= -1) || hue == 0;
        return hueOk && chroma >= -100 && chroma <= 100 && bright >= -100 && bright <= 100;
    }

    static boolean isCashEffectItem(int itemId) {
        return itemId >= 5010000 && itemId <= 5019999;
    }

    private static boolean isLookTinted(Character chr, int kind) {
        return switch (kind) {
            case LOOK_HAIR -> chr.isHairTinted();
            case LOOK_FACE -> chr.isFaceTinted();
            case LOOK_SKIN -> chr.isSkinTinted();
            default -> false;
        };
    }

    private static void setLookTint(Character chr, int kind, int hue, int chroma, int bright, boolean clear) {
        switch (kind) {
            case LOOK_HAIR -> {
                if (clear) {
                    chr.clearHairTint();
                } else {
                    chr.setHairTint(hue, chroma, bright);
                }
            }
            case LOOK_FACE -> {
                if (clear) {
                    chr.clearFaceTint();
                } else {
                    chr.setFaceTint(hue, chroma, bright);
                }
            }
            case LOOK_SKIN -> {
                if (clear) {
                    chr.clearSkinTint();
                } else {
                    chr.setSkinTint(hue, chroma, bright);
                }
            }
            default -> {
            }
        }
    }
}
