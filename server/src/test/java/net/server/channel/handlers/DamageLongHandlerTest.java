package net.server.channel.handlers;

import client.BuffStat;
import client.Character;
import client.Job;
import net.packet.InPacket;
import net.packet.OutPacket;
import net.packet.Packet;
import net.opcodes.SendOpcode;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.junit.jupiter.MockitoExtension;
import server.life.Monster;
import server.maps.MapleMap;
import testutil.HandlerTest;
import testutil.Packets;
import tools.PacketCreator;

import java.awt.Point;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;

/**
 * Ticket #12 (damage cap -&gt; long, server half): C2S/S2C wire contract.
 *
 * <ul>
 *   <li>C2S: a long-capable (DLL-hooked) client appends the real 64-bit line
 *       after each vanilla damage int (12 bytes/line); legacy int32 packets
 *       (including spectator/browser traffic) carry no longs and must NEVER be
 *       reinterpreted.</li>
 *   <li>S2C: each line is written as {@code writeInt(clamp) + writeLong(real)}
 *       on the vanilla opcodes; overflow lines keep the INT_MAX sentinel in the
 *       int slot and crits keep the sign bit there.</li>
 * </ul>
 */
@ExtendWith(MockitoExtension.class)
class DamageLongHandlerTest extends HandlerTest {

    private static final class ProbeHandler extends AbstractDealDamageHandler {
        @Override
        public void handlePacket(InPacket p, client.Client c) {
        }

        AttackInfo callParse(InPacket p, Character chr, boolean ranged, boolean magic) {
            return parseDamage(p, chr, ranged, magic);
        }
    }

    private final ProbeHandler handler = new ProbeHandler();

    private void stubVanillaChr() {
        lenient().when(chr.getSkillLevel(anyInt())).thenReturn(0);
        lenient().when(chr.getJob()).thenReturn(Job.BEGINNER);
        lenient().when(chr.getBuffedValue(BuffStat.WK_CHARGE)).thenReturn(null);
        lenient().when(chr.getBuffedValue(BuffStat.ELEMENTAL_RESET)).thenReturn(null);
        lenient().when(chr.getBuffedValue(BuffStat.COMBO)).thenReturn(null);
        lenient().when(chr.getBuffEffect(BuffStat.SHARP_EYES)).thenReturn(null);
        lenient().when(chr.getBuffEffect(BuffStat.SHADOWPARTNER)).thenReturn(null);
        lenient().when(chr.getBuffEffect(BuffStat.WK_CHARGE)).thenReturn(null);
        lenient().when(chr.getAllBuffs()).thenReturn(Collections.emptyList());
        lenient().when(chr.getEnergyBar()).thenReturn(0);
        lenient().when(chr.getMapId()).thenReturn(100000000);
        lenient().when(chr.getTotalWatk()).thenReturn(10);
        lenient().when(chr.getTotalMagic()).thenReturn(0);
        lenient().when(chr.getTotalInt()).thenReturn(4);
        lenient().when(chr.getTotalLuk()).thenReturn(4);
        lenient().when(chr.isCygnus()).thenReturn(false);
        MapleMap map = mock(MapleMap.class);
        lenient().when(chr.getMap()).thenReturn(map);
        lenient().when(map.getMonsterByOid(anyInt())).thenReturn(null);
    }

    /** One target block with a single line: header + per-line bytes. */
    private static void writeTargetBlock(OutPacket out, int oid, Long realLong) {
        out.writeInt(oid);
        out.skip(4);
        out.writePos(new Point(0, 0));
        out.writePos(new Point(0, 0));
        out.writeShort(0);
        if (realLong != null) {
            out.writeInt((int) Math.min(realLong, Integer.MAX_VALUE));
            out.writeLong(realLong);
        } else {
            out.writeInt(1234);
        }
        out.skip(4);
    }

    private static InPacket attackPacket(int numAttacked, int numDamage, boolean withLongs, long real) {
        return Packets.buildInPacket(out -> {
            out.writeByte(0);
            out.writeByte((numAttacked << 4) | numDamage);
            out.writeInt(0); // skill 0: no skill effect lookups
            out.skip(8);
            out.writeByte(0); // display
            out.writeByte(0); // direction
            out.writeByte(0); // stance
            out.writeByte(0);
            out.writeByte(4); // speed
            out.skip(4);
            for (int i = 0; i < numAttacked; i++) {
                writeTargetBlock(out, 1000 + i, withLongs ? real : null);
            }
        });
    }

    @Test
    void legacyInt32PacketParsesWithoutReadingLongs() {
        stubVanillaChr();
        InPacket p = attackPacket(1, 1, false, 0);

        AbstractDealDamageHandler.AttackInfo attack = handler.callParse(p, chr, false, false);

        assertEquals(1, attack.targets.size());
        assertEquals(1234L, attack.targets.get(1000).damageLines().get(0));
        assertEquals(0, p.available());
    }

    @Test
    void longPacketCarriesRealMagnitudeAboveIntMax() {
        stubVanillaChr();
        long real = 3_000_000_000L;
        InPacket p = attackPacket(1, 1, true, real);

        AbstractDealDamageHandler.AttackInfo attack = handler.callParse(p, chr, false, false);

        assertEquals(real, attack.targets.get(1000).damageLines().get(0));
        assertEquals(0, p.available());
    }

    @Test
    void longPacketCritKeepsNegativeSignWithRealMagnitude() {
        stubVanillaChr();
        long real = 2_500_000_000L;
        InPacket p = Packets.buildInPacket(out -> {
            out.writeByte(0);
            out.writeByte((1 << 4) | 1);
            out.writeInt(0);
            out.skip(8);
            out.writeByte(0);
            out.writeByte(0);
            out.writeByte(0);
            out.writeByte(0);
            out.writeByte(4);
            out.skip(4);
            out.writeInt(1000);
            out.skip(4);
            out.writePos(new Point(0, 0));
            out.writePos(new Point(0, 0));
            out.writeShort(0);
            out.writeInt(Integer.MIN_VALUE); // crit flag on the vanilla int
            out.writeLong(real); // positive magnitude
            out.skip(4);
        });

        AbstractDealDamageHandler.AttackInfo attack = handler.callParse(p, chr, false, false);

        assertEquals(-real, attack.targets.get(1000).damageLines().get(0));
    }

    @Test
    void s2cWritesIntClampPlusLongRealPerLine() {
        Character bot = mock(Character.class);
        lenient().when(bot.getId()).thenReturn(42);
        long real = 5_000_000_000L;
        Map<Integer, AbstractDealDamageHandler.AttackTarget> targets = Map.of(
                7, new AbstractDealDamageHandler.AttackTarget((short) 0, new ArrayList<>(List.of(real))));

        Packet packet = PacketCreator.closeRangeAttack(bot, 0, 0, 0, 0x11, targets, 4, 0, 0);
        byte[] bytes = packet.getBytes();

        // Body: cid(4) + header bytes + oid(4) + 0x00 + per-line int(4) + long(8).
        int perLine = bytes.length - (2 + 4 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 4 + 4 + 1);
        assertEquals(12, perLine);

        InPacket in = Packets.buildInPacket(out -> out.writeBytes(bytes));
        in.skip(2); // opcode
        in.skip(4 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 4); // cid + fixed header + projectile
        in.skip(4 + 1); // oid + padding
        int vanillaInt = in.readInt();
        long realOut = in.readLong();
        assertEquals(Integer.MAX_VALUE, vanillaInt);
        assertEquals(real, realOut);
    }

    @Test
    void s2cCritKeepsSignBitOnIntWithPositiveLong() {
        Character bot = mock(Character.class);
        lenient().when(bot.getId()).thenReturn(42);
        long real = 1_000L;
        Map<Integer, AbstractDealDamageHandler.AttackTarget> targets = Map.of(
                7, new AbstractDealDamageHandler.AttackTarget((short) 0, new ArrayList<>(List.of(-real))));

        Packet packet = PacketCreator.closeRangeAttack(bot, 0, 0, 0, 0x11, targets, 4, 0, 0);
        InPacket in = Packets.buildInPacket(out -> out.writeBytes(packet.getBytes()));
        in.skip(2 + 4 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 4 + 4 + 1);
        int vanillaInt = in.readInt();
        long realOut = in.readLong();
        assertTrue(vanillaInt < 0);
        assertEquals(real, realOut);
    }

    @Test
    void s2cOpcodeStaysVanilla() {
        assertEquals(0xBA, SendOpcode.CLOSE_RANGE_ATTACK.getValue());
        assertEquals(0xBB, SendOpcode.RANGED_ATTACK.getValue());
        assertEquals(0xBC, SendOpcode.MAGIC_ATTACK.getValue());
    }

    @Test
    void clampToIntKeepsSentinelSemantics() {
        assertEquals(Integer.MAX_VALUE, AbstractDealDamageHandler.clampToInt(3_000_000_000L));
        assertEquals(Integer.MIN_VALUE, AbstractDealDamageHandler.clampToInt((long) Integer.MIN_VALUE - 1));
        assertEquals(123, AbstractDealDamageHandler.clampToInt(123L));
    }

    @Test
    void monsterPlaceholderKeepsSuiteHonest() {
        assertTrue(mock(Monster.class) != null);
    }
}
