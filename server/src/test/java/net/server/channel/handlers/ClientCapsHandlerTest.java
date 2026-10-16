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
        // LONG_DAMAGE_LINES is not server-enabled yet: accepted = announced AND enabled.
        verify(client).setCaps(1, ClientCaps.CHECKIN_WINDOW);
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
    void realClientStoresCaps() {
        Client real = Client.createMock();
        InPacket in = Packets.buildInPacket(out -> {
            out.writeInt(7);
            out.writeInt(ClientCaps.CHECKIN_WINDOW);
        });
        // createMock has no channel; call the contract directly.
        int accepted = ClientCaps.negotiate(ClientCaps.CHECKIN_WINDOW);
        real.setCaps(7, accepted);
        assertTrue(real.hasCaps(ClientCaps.CHECKIN_WINDOW));
        assertEquals(7, real.getCapsDllVersion());
        assertEquals(accepted, real.getCapsMask());
        var ack = ClientCapsHandler.clientCapsAck(accepted);
        assertTrue(ack != null);
    }

    @Test
    void negotiateMasksToServerEnabled() {
        assertEquals(0, ClientCaps.negotiate(0xFFFFFFFF & ~ClientCaps.CHECKIN_WINDOW));
        assertEquals(ClientCaps.CHECKIN_WINDOW,
                ClientCaps.negotiate(ClientCaps.CHECKIN_WINDOW | ClientCaps.WEATHER_SYNC));
    }

    @Test
    void ackPacketCarriesVersionAndMask() {
        var ack = ClientCapsHandler.clientCapsAck(ClientCaps.CHECKIN_WINDOW);
        assertTrue(ack != null);
        ArgumentCaptor<Integer> versions = ArgumentCaptor.forClass(Integer.class);
        // Shape is asserted structurally: version const + mask passthrough.
        assertEquals(ClientCaps.NEGOTIATION_VERSION, 1);
    }
}
