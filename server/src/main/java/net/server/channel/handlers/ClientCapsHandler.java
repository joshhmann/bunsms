package net.server.channel.handlers;

import client.Client;
import client.ClientCaps;
import net.AbstractPacketHandler;
import net.opcodes.SendOpcode;
import net.packet.InPacket;
import net.packet.OutPacket;
import net.packet.Packet;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Capability negotiation (contract v1, server-owned).
 *
 * <p>The DLL sends C2S CLIENT_CAPS_ANNOUNCE (0x373A: int dllVersion + int
 * featureMask) as the first packet on every new game socket. The server
 * records accepted = announced AND {@link ClientCaps#SERVER_ENABLED} on the
 * Client (per-connection; default 0 = legacy) and replies S2C
 * CLIENT_CAPS_ACK (0x373B: int negotiationVersion + int acceptedMask).
 *
 * <p>The ack is sent ONLY here, as a direct reply — never unsolicited, never
 * broadcast. Stock clients never send 0x373A, so their wire surface is
 * untouched. validateState returns true: announce precedes login.
 */
public final class ClientCapsHandler extends AbstractPacketHandler {

    private static final Logger log = LoggerFactory.getLogger(ClientCapsHandler.class);

    @Override
    public boolean validateState(Client c) {
        return true;
    }

    @Override
    public void handlePacket(InPacket p, Client c) {
        if (p.available() < 8) {
            log.debug("[Caps] short announce ({} bytes), ignoring", p.available());
            return;
        }
        int dllVersion = p.readInt();
        int announced = p.readInt();
        int accepted = ClientCaps.negotiate(announced);
        c.setCaps(dllVersion, accepted);
        c.sendPacket(clientCapsAck(accepted));
        log.info("[Caps] dllVersion={} announced=0x{} accepted=0x{}",
                dllVersion, Integer.toHexString(announced), Integer.toHexString(accepted));
    }

    /** S2C CLIENT_CAPS_ACK (0x373B). Reply-only; never broadcast. */
    public static Packet clientCapsAck(int acceptedMask) {
        OutPacket p = OutPacket.create(SendOpcode.CLIENT_CAPS_ACK);
        p.writeInt(ClientCaps.NEGOTIATION_VERSION);
        p.writeInt(acceptedMask);
        return p;
    }
}
