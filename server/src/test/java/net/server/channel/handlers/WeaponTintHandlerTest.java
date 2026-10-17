package net.server.channel.handlers;

import client.Character;
import client.ClientCaps;
import client.inventory.Equip;
import client.inventory.Inventory;
import client.inventory.InventoryType;
import client.inventory.Item;
import constants.id.ItemId;
import net.packet.InPacket;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.Mockito;
import org.mockito.junit.jupiter.MockitoExtension;
import server.colorprism.ColorPrismPackets;
import testutil.HandlerTest;
import testutil.Packets;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * Coloring prism server-half contract: the seven C2S actions, prism consumption,
 * never-dyed restore refusal, tint validation,
 * and the S2C snapshot layout the DLL-side window decodes. The client window and
 * hooks (coloringprism.cpp/weapontint.cpp) are DLL-side per the owner DLL-first
 * policy — this is the server half only.
 *
 * <p>Real {@code Equip} instances are never constructed here: the ctor touches
 * {@code ItemInformationProvider}, which needs the WZ-backed connection pool.
 * Equips are Mockito mocks; tint state lives in stubbed getters and is asserted
 * through the setter calls the handler makes.
 */
@ExtendWith(MockitoExtension.class)
class WeaponTintHandlerTest extends HandlerTest {

    private final WeaponTintHandler handler = new WeaponTintHandler();

    @Mock
    private Inventory equippedInv;

    @Mock
    private Inventory cashInv;

    private static final int SWORD_ID = 1302000;

    private void stubInventories() {
        lenient().when(client.hasCaps(ClientCaps.PRISM_SYNC)).thenReturn(true);
        lenient().when(chr.getInventory(InventoryType.EQUIP)).thenReturn(Mockito.mock(Inventory.class));
        lenient().when(chr.getInventory(InventoryType.EQUIPPED)).thenReturn(equippedInv);
        lenient().when(chr.getInventory(InventoryType.CASH)).thenReturn(cashInv);
        lenient().when(equippedInv.list()).thenReturn(List.of());
        lenient().when(cashInv.list()).thenReturn(List.of());
        lenient().when(chr.getSkillTints()).thenReturn(java.util.Map.of());
    }

    /** A mock Equip whose tint getters answer from a backing real Item's tint state. */
    private Equip mockEquip(boolean tinted, boolean fxTinted) {
        Equip equip = Mockito.mock(Equip.class);
        lenient().when(equip.getItemId()).thenReturn(SWORD_ID);
        lenient().when(equip.getPosition()).thenReturn((short) -11);
        lenient().when(equip.isTinted()).thenReturn(tinted);
        lenient().when(equip.isFxTinted()).thenReturn(fxTinted);
        return equip;
    }

    private void givePrism(short slot) {
        Item prism = new Item(ItemId.COLORING_PRISM, slot, (short) 1);
        lenient().when(cashInv.getItem(slot)).thenReturn(prism);
    }

    private InPacket requestPacket() {
        return Packets.buildInPacket(out -> out.writeByte(WeaponTintHandler.ACTION_REQUEST));
    }

    private InPacket applyPacket(int itemId, short targetPos, short prismPos,
                                 int hue, int chroma, int bright, int layer) {
        return Packets.buildInPacket(out -> {
            out.writeByte(WeaponTintHandler.ACTION_APPLY);
            out.writeByte(InventoryType.EQUIPPED.getType());
            out.writeShort(targetPos);
            out.writeInt(itemId);
            out.writeShort(hue);
            out.writeByte(chroma);
            out.writeByte(bright);
            out.writeShort(prismPos);
            out.writeByte(layer);
        });
    }

    private InPacket restorePacket(int itemId, short targetPos, short prismPos, int layer) {
        return Packets.buildInPacket(out -> {
            out.writeByte(WeaponTintHandler.ACTION_RESTORE);
            out.writeByte(InventoryType.EQUIPPED.getType());
            out.writeShort(targetPos);
            out.writeInt(itemId);
            out.writeShort(prismPos);
            out.writeByte(layer);
        });
    }

    @Test
    void nullPlayerSendsNothing() {
        lenient().when(client.getPlayer()).thenReturn(null);

        handler.handlePacket(requestPacket(), client);

        verify(client, never()).sendPacket(any());
    }

    @Test
    void emptyPacketSendsNothing() {
        stubInventories();

        handler.handlePacket(Packets.buildInPacket(out -> {}), client);

        verify(client, never()).sendPacket(any());
    }

    @Test
    void unknownActionSendsNothing() {
        stubInventories();

        handler.handlePacket(Packets.buildInPacket(out -> out.writeByte(77)), client);

        verify(client, never()).sendPacket(any());
    }

    @Test
    void shortApplySendsNothing() {
        stubInventories();

        handler.handlePacket(
                Packets.buildInPacket(out -> {
                    out.writeByte(WeaponTintHandler.ACTION_APPLY);
                    out.writeByte(1);
                }),
                client);

        verify(client, never()).sendPacket(any());
    }

    @Test
    void applyWithMismatchedItemIdRefuses() {
        stubInventories();
        Equip target = mockEquip(false, false);
        lenient().when(equippedInv.getItem((short) -11)).thenReturn(target);
        givePrism((short) 1);

        handler.handlePacket(applyPacket(SWORD_ID + 1, (short) -11, (short) 1, 120, 10, 10,
                WeaponTintHandler.LAYER_BODY), client);

        verify(target, never()).setTint(any(int.class), any(int.class), any(int.class));
        verify(chr, never()).syncWeaponTint();
    }

    @Test
    void applyWithMissingSlotRefuses() {
        stubInventories();
        lenient().when(equippedInv.getItem((short) -11)).thenReturn(null);
        givePrism((short) 1);

        handler.handlePacket(applyPacket(SWORD_ID, (short) -11, (short) 1, 120, 10, 10,
                WeaponTintHandler.LAYER_BODY), client);

        verify(chr, never()).syncWeaponTint();
    }

    @Test
    void outOfRangeTintRefusesWithMessage() {
        stubInventories();
        Equip target = mockEquip(false, false);
        lenient().when(equippedInv.getItem((short) -11)).thenReturn(target);
        givePrism((short) 1);

        handler.handlePacket(applyPacket(SWORD_ID, (short) -11, (short) 1, 120, 101, 0,
                WeaponTintHandler.LAYER_BODY), client);

        verify(chr).dropMessage(Mockito.eq(1), Mockito.contains("range"));
        verify(target, never()).setTint(any(int.class), any(int.class), any(int.class));
    }

    @Test
    void missingPrismRefusesWithMessage() {
        stubInventories();
        Equip target = mockEquip(false, false);
        lenient().when(equippedInv.getItem((short) -11)).thenReturn(target);
        lenient().when(cashInv.getItem((short) 1)).thenReturn(null);

        handler.handlePacket(applyPacket(SWORD_ID, (short) -11, (short) 1, 120, 10, 10,
                WeaponTintHandler.LAYER_BODY), client);

        verify(chr).dropMessage(Mockito.eq(1), Mockito.contains("Coloring Prism"));
        verify(target, never()).setTint(any(int.class), any(int.class), any(int.class));
    }

    @Test
    void restoreNeverDyedConsumesNothing() {
        stubInventories();
        Equip target = mockEquip(false, false);
        lenient().when(equippedInv.getItem((short) -11)).thenReturn(target);
        givePrism((short) 1);

        handler.handlePacket(restorePacket(SWORD_ID, (short) -11, (short) 1,
                WeaponTintHandler.LAYER_BODY), client);

        verify(chr, never()).syncWeaponTint();
        verify(target, never()).clearTint();
    }

    @Test
    void identityApplyOnNeverDyedConsumesNothing() {
        stubInventories();
        Equip target = mockEquip(false, false);
        lenient().when(equippedInv.getItem((short) -11)).thenReturn(target);
        givePrism((short) 1);

        handler.handlePacket(applyPacket(SWORD_ID, (short) -11, (short) 1, 0, 0, 0,
                WeaponTintHandler.LAYER_BODY), client);

        verify(chr, never()).syncWeaponTint();
        verify(target, never()).clearTint();
    }

    @Test
    void snapshotRoundTripDecodes() {
        // Pure packet-layout check: key, hue, chroma, bright per entry.
        var pkt = ColorPrismPackets.snapshot(snapshotChr(true, false));
        byte[] raw = pkt.getBytes();
        InPacket in = Packets.buildInPacket(out -> out.writeBytes(raw));
        assertEquals(0x372F, in.readShort() & 0xFFFF);
        assertEquals(ColorPrismPackets.RESP_SNAPSHOT, in.readByte());
        assertEquals(4242, in.readInt());
        assertEquals(2, in.readShort());
        assertEquals(SWORD_ID, in.readInt());
        assertEquals(120, in.readShort());
        assertEquals(10, in.readByte());
        assertEquals(-5, in.readByte());
        assertEquals(ColorPrismPackets.KEY_HAIR, in.readInt());
        assertEquals(200, in.readShort());
        assertEquals(0, in.readByte());
        assertEquals(0, in.readByte());
        assertEquals(0, in.available());
    }

    @Test
    void snapshotOmitsIdentityEntries() {
        var pkt = ColorPrismPackets.snapshot(snapshotChr(false, false));
        InPacket in = Packets.buildInPacket(out -> out.writeBytes(pkt.getBytes()));
        in.readShort();
        in.readByte();
        in.readInt();
        assertEquals(0, in.readShort());
        assertEquals(0, in.available());
    }

    @Test
    void snapshotIncludesFxAndSkillKeys() {
        var pkt = ColorPrismPackets.snapshot(snapshotChr(false, true));
        InPacket in = Packets.buildInPacket(out -> out.writeBytes(pkt.getBytes()));
        in.readShort();
        in.readByte();
        in.readInt();
        assertEquals(2, in.readShort());
        assertEquals(SWORD_ID + ColorPrismPackets.EFFECT_KEY_OFFSET, in.readInt());
        assertEquals(30, in.readShort());
        assertEquals(0, in.readByte());
        assertEquals(0, in.readByte());
        assertEquals(1000 + ColorPrismPackets.SKILL_KEY_OFFSET, in.readInt());
        assertEquals(331, in.readShort());
        assertEquals(20, in.readByte());
        assertEquals(10, in.readByte());
        assertEquals(0, in.available());
    }

    @Test
    void tintValidationBands() {
        assertTrue(WeaponTintHandler.isValidTint(1, 0, 0));
        assertTrue(WeaponTintHandler.isValidTint(359, -100, 100));
        assertTrue(WeaponTintHandler.isValidTint(-1, 0, 0));
        assertTrue(WeaponTintHandler.isValidTint(-360, 0, 0));
        assertTrue(WeaponTintHandler.isValidTint(0, 0, 0));
        assertFalse(WeaponTintHandler.isValidTint(360, 0, 0));
        assertFalse(WeaponTintHandler.isValidTint(-361, 0, 0));
        assertFalse(WeaponTintHandler.isValidTint(120, 101, 0));
        assertFalse(WeaponTintHandler.isValidTint(120, 0, -101));
    }

    // Snapshot doubles use Mockito mocks (Character's ctor is private).
    // Body tint comes from a mock Equip; hair/skill flags toggle extra entries.
    private static Character snapshotChr(boolean hair, boolean fxAndSkill) {
        Character snap = Mockito.mock(Character.class);
        Equip sword = Mockito.mock(Equip.class);
        lenient().when(sword.getItemId()).thenReturn(SWORD_ID);
        lenient().when(sword.isTinted()).thenReturn(!fxAndSkill);
        lenient().when(sword.getTintHue()).thenReturn((short) 120);
        lenient().when(sword.getTintChroma()).thenReturn((byte) 10);
        lenient().when(sword.getTintBright()).thenReturn((byte) -5);
        lenient().when(sword.isFxTinted()).thenReturn(fxAndSkill);
        lenient().when(sword.getTintFxHue()).thenReturn((short) 30);
        lenient().when(sword.getTintFxChroma()).thenReturn((byte) 0);
        lenient().when(sword.getTintFxBright()).thenReturn((byte) 0);
        Inventory equipped = Mockito.mock(Inventory.class);
        Inventory cash = Mockito.mock(Inventory.class);
        lenient().when(snap.getId()).thenReturn(4242);
        lenient().when(snap.getInventory(InventoryType.EQUIPPED)).thenReturn(equipped);
        lenient().when(snap.getInventory(InventoryType.CASH)).thenReturn(cash);
        lenient().when(equipped.list()).thenReturn((hair || fxAndSkill) ? List.of(sword) : List.of());
        lenient().when(cash.list()).thenReturn(List.of());
        lenient().when(snap.isHairTinted()).thenReturn(hair);
        lenient().when(snap.isFaceTinted()).thenReturn(false);
        lenient().when(snap.isSkinTinted()).thenReturn(false);
        lenient().when(snap.getHairTintHue()).thenReturn((short) 200);
        lenient().when(snap.getHairTintChroma()).thenReturn((byte) 0);
        lenient().when(snap.getHairTintBright()).thenReturn((byte) 0);
        lenient().when(snap.getSkillTints()).thenReturn(
                fxAndSkill ? java.util.Map.of(1000, new int[]{331, 20, 10}) : java.util.Map.of());
        return snap;
    }

}
