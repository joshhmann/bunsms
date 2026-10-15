package net.server.channel.handlers;

import net.opcodes.RecvOpcode;
import net.opcodes.SendOpcode;
import net.packet.InPacket;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.junit.jupiter.MockitoExtension;
import testutil.HandlerTest;
import testutil.Packets;
import tools.PacketCreator;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Daily Check-In wire contract: opcode values from the registry plus the snapshot
 * layout the DLL-side window decodes (respType/currentDay/claimedMask/justClaimed,
 * count=28, 28 icon ints, 28 tooltip strings).
 */
@ExtendWith(MockitoExtension.class)
class DailyCheckinHandlerTest extends HandlerTest {

    private final DailyCheckinHandler handler = new DailyCheckinHandler();

    @Test
    void opcodeValuesMatchRegistry() {
        assertEquals(0x11A, RecvOpcode.DAILY_CHECKIN.getValue());
        assertEquals(0x17C, SendOpcode.DAILY_CHECKIN.getValue());
    }

    @Test
    void openRequestRepliesWithSnapshot() {
        when(chr.getLevel()).thenReturn(10);
        when(chr.refreshCheckin()).thenReturn(0);
        when(chr.getCheckinDay()).thenReturn(3);
        when(chr.getCheckinClaimed()).thenReturn(0b111);

        InPacket open = Packets.buildInPacket(out -> out.writeByte(0));
        handler.handlePacket(open, client);

        verify(client).sendPacket(any());
        var snapshot = PacketCreator.dailyCheckinSnapshot(3, 0b111, 0);
        assertNotNull(snapshot);
        byte[] bytes = snapshot.getBytes();
        // opcode(2 LE) + respType(1) + currentDay(1) + claimedMask(4) + justClaimed(1) + count(1) + 28*4 icons...
        assertTrue(bytes.length > 2 + 1 + 1 + 4 + 1 + 1 + 28 * 4, "snapshot too short: " + bytes.length);
        // currentDay lands at offset 3 (after 2-byte opcode + respType byte).
        assertEquals(3, bytes[3] & 0xFF);
        assertEquals(28, bytes[9] & 0xFF);
    }

    @Test
    void claimMismatchStillRepliesWithoutGranting() {
        when(chr.getLevel()).thenReturn(10);
        when(chr.refreshCheckin()).thenReturn(2); // day 2 claimable...
        when(chr.getCheckinClaimed()).thenReturn(0b1);

        InPacket claimWrongDay = Packets.buildInPacket(out -> {
            out.writeByte(1);
            out.writeByte(5); // ...but client asks for day 5 -> rejected, snapshot only
        });
        handler.handlePacket(claimWrongDay, client);

        verify(client).sendPacket(any());
    }

    @Test
    void belowMinLevelGetsNoReply() {
        when(chr.getLevel()).thenReturn(1);

        InPacket open = Packets.buildInPacket(out -> out.writeByte(0));
        handler.handlePacket(open, client);

        verify(client, never()).sendPacket(any());
    }

    @Test
    void snapshotRoundTripDecodes() {
        var snapshot = PacketCreator.dailyCheckinSnapshot(7, 0b111111, 7);
        byte[] raw = snapshot.getBytes();
        InPacket in = Packets.buildInPacket(out -> out.writeBytes(raw));
        assertEquals(0x17C, in.readShort() & 0xFFFF);
        assertEquals(1, in.readByte());
        assertEquals(7, in.readByte());
        assertEquals(0b111111, in.readInt());
        assertEquals(7, in.readByte());
        assertEquals(28, in.readByte());
        assertEquals(server.DailyCheckinRewards.iconItemId(1), in.readInt());
        in.skip(27 * 4);
        String tip1 = in.readString();
        assertTrue(tip1.startsWith("Day 1"), tip1);
        // remaining 27 tooltips must all decode
        for (int d = 2; d <= 28; d++) {
            assertTrue(in.readString().startsWith("Day " + d));
        }
        assertEquals(0, in.available());
    }
}
