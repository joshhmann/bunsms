package client;

/**
 * Per-connection client capability flags negotiated with the DLL injector.
 *
 * <p>Contract v1 (server-owned; mirror of client/caps.h): the DLL sends C2S
 * CLIENT_CAPS_ANNOUNCE (0x373A: int dllVersion + int featureMask) as the first
 * packet on every new game socket (login + each channel connect/reconnect). The
 * server replies S2C CLIENT_CAPS_ACK (0x373B) and records the accepted mask here.
 *
 * <p>Default is EMPTY: a session that never announces is a legacy/stock client
 * and MUST receive byte-exact v83 bytes on every opcode. Caps are per-Client
 * (per-connection); channel change creates a new Client server-side, so there
 * is no carryover by construction.
 */
public final class ClientCaps {

    /** Server negotiation version sent in the ack. DLL fail-closes unless == 1. */
    public static final int NEGOTIATION_VERSION = 1;

    /** Per-line int+long damage transport (12-byte lines C2S/S2C). */
    public static final int LONG_DAMAGE_LINES = 0x01;
    /** Unsolicited prism snapshots (0x372F). */
    public static final int PRISM_SYNC = 0x02;
    /** Unsolicited check-in snapshots/auto-open (0x17C). */
    public static final int CHECKIN_WINDOW = 0x04;
    /** Unsolicited weather sync (0x373D). */
    public static final int WEATHER_SYNC = 0x08;
    /** Lamp preview packets (0x373F). */
    public static final int LAMP_PREVIEW = 0x10;
    /** Cash-shop window packets (0x3730/0x3731). */
    public static final int CASHSHOP_WINDOW = 0x20;

    /** Implemented paired RC features; legacy connections still negotiate no bits. */
    public static final int SERVER_ENABLED = LONG_DAMAGE_LINES | PRISM_SYNC | CHECKIN_WINDOW
            | WEATHER_SYNC | LAMP_PREVIEW | CASHSHOP_WINDOW;

    private ClientCaps() {
    }

    /** Zero means legacy: no announced caps on this connection. */
    public static boolean isLegacy(int acceptedMask) {
        return acceptedMask == 0;
    }

    public static boolean has(int acceptedMask, int bit) {
        return (acceptedMask & bit) == bit;
    }

    /** accepted = announced AND server-enabled (server never grants what it disabled). */
    public static int negotiate(int announcedMask) {
        return announcedMask & SERVER_ENABLED;
    }
}
