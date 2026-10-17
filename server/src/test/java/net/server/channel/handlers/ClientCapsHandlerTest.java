package net.server.channel.handlers;

import client.Client;
import client.ClientCaps;
import net.packet.InPacket;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.junit.jupiter.MockitoExtension;
import testutil.HandlerTest;
import testutil.Packets;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * Capability negotiation contract (v1, server-owned): announce/ack wire shape,
 * per-connection default-legacy, fail-closed version, server-enabled masking.
 */
@ExtendWith(MockitoExtension.class)
class ClientCapsHandlerTest extends HandlerTest {

    private final ClientCapsHandler handler = new ClientCapsHandler();

    @Test
    void defaultSessionIsLegacy() {
        Client legacy = Client.createMock();
        assertEquals(0, legacy.getCapsMask());
        assertTrue(ClientCaps.isLegacy(legacy.getCapsMask()));
        assertFalse(legacy.hasCaps(ClientCaps.CHECKIN_WINDOW));
    }

    @Test
    void announceRecordsAcceptedAndRepliesAck() {
        InPacket in = Packets.buildInPacket(out -> {
            out.writeInt(1);
            out.writeInt(ClientCaps.CHECKIN_WINDOW | ClientCaps.LONG_DAMAGE_LINES);
        });
        handler.handlePacket(in, client);
        verify(client).setCaps(1, ClientCaps.CHECKIN_WINDOW | ClientCaps.LONG_DAMAGE_LINES);
        verify(client).sendPacket(any());
    }

    @Test
    void shortAnnounceIgnoredWithoutReply() {
        InPacket in = Packets.buildInPacket(out -> out.writeByte(1));
        handler.handlePacket(in, client);
        verify(client, never()).setCaps(1, ClientCaps.CHECKIN_WINDOW);
        verify(client, never()).sendPacket(any());
    }

    @Test
    void ackBytesCarryVersionAndAcceptedMask() {
        // Wire proof: decode the actual ack packet bytes (opcode + version + mask).
        var ack = ClientCapsHandler.clientCapsAck(ClientCaps.CHECKIN_WINDOW);
        InPacket in = Packets.buildInPacket(out -> out.writeBytes(ack.getBytes()));
        int opcode = in.readShort() & 0xFFFF;
        assertEquals(0x373B, opcode);
        assertEquals(ClientCaps.NEGOTIATION_VERSION, in.readInt());
        assertEquals(ClientCaps.CHECKIN_WINDOW, in.readInt());
        assertEquals(0, in.available());
    }
}
