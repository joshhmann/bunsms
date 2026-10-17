package server.weather;

import net.opcodes.SendOpcode;
import net.packet.Packet;
import net.server.task.WeatherTask;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Weather/time server-half contract: opcode values from the registry, the packet
 * layouts the DLL decodes, the region/sky/palette invariants, and the combat
 * scalars. Client rendering (weather.cpp, lamps.cpp, sway, WZ art) is DLL-side
 * per the owner DLL-first policy — this is the server half only.
 */
class WeatherServiceTest {

    @Test
    void opcodeValuesMatchRegistry() {
        assertEquals(0x373D, SendOpcode.WEATHER_SYNC.getValue());
        assertEquals(0x373F, SendOpcode.LAMP_PREVIEW.getValue());
    }

    @Test
    void weatherTaskIntervalIsOneMinute() {
        assertEquals(60L * 1000L, WeatherTask.INTERVAL_MS);
    }

    @Test
    void clockInvariants() {
        assertEquals(1440, WeatherService.MINUTES_PER_DAY);
        assertTrue(WeatherService.msPerGameMinute() > 0);
        int minute = WeatherService.minuteOfDay();
        assertTrue(minute >= 0 && minute < 1440);
        // Night curve endpoints: midnight is night, noon is not.
        assertTrue(WeatherService.TIME_NIGHT == 0);
        assertTrue(WeatherService.TIME_DAY == 12 * 60);
    }

    @Test
    void nightLevelMidnightAndNoon() {
        // Freeze at midnight: full night. Freeze at noon: full day.
        WeatherService.setTime(0);
        try {
            assertEquals(1.0f, WeatherService.nightLevel(), 0.001f);
        } finally {
            WeatherService.clearTimeOverride();
        }
        WeatherService.setTime(12 * 60);
        try {
            assertEquals(0.0f, WeatherService.nightLevel(), 0.001f);
        } finally {
            WeatherService.clearTimeOverride();
        }
    }

    @Test
    void skyNamesRoundTrip() {
        for (WeatherProfile p : WeatherProfile.values()) {
            assertEquals(p, WeatherProfile.byId(p.id()));
            assertEquals(p, WeatherProfile.byName(p.profileName()));
        }
        // Unknown ids fall back to CLEAR, never null.
        assertEquals(WeatherProfile.CLEAR, WeatherProfile.byId((byte) 99));
    }

    @Test
    void profileIdsAreOrdinalStable() {
        // SEASON_WEIGHTS is indexed by ordinal; ids must equal ordinals.
        for (WeatherProfile p : WeatherProfile.values()) {
            assertEquals(p.ordinal(), p.id());
        }
    }

    @Test
    void regionsResolveAndPalettesAlign() {
        // Every region has a like-named palette (fail-fast contract).
        for (WeatherRegion r : WeatherRegion.values()) {
            assertEquals(r.name(), WeatherPalette.forRegion(r).name());
        }
        // Spot checks on the prefix rule.
        assertEquals(WeatherRegion.HENESYS, WeatherRegion.forMap(100000000));
        assertEquals(WeatherRegion.ELLINIA, WeatherRegion.forMap(101000000));
        assertEquals(WeatherRegion.EL_NATH, WeatherRegion.forMap(211000000));
        assertEquals(WeatherRegion.ARIANT, WeatherRegion.forMap(260000000));
        assertEquals(WeatherRegion.MUSHROOM_SHRINE, WeatherRegion.forMap(800000000));
        assertEquals(WeatherRegion.DEFAULT, WeatherRegion.forMap(-1));
    }

    @Test
    void forcedRegionsReportTheirSky() {
        assertEquals(WeatherProfile.SNOW.id(), WeatherService.skyForMap(211000100));
        assertEquals(WeatherProfile.BLOSSOM.id(), WeatherService.skyForMap(800000000));
    }

    @Test
    void weatherSyncPacketShape() {
        Packet p = WeatherPackets.weatherSync(100000000, true);
        // 28 bytes including the opcode: short + short + int + byte + byte
        // + int + 3 bytes + short + byte + int + int.
        assertEquals(28, p.getBytes().length);
        byte[] b = p.getBytes();
        int opcode = (b[0] & 0xFF) | ((b[1] & 0xFF) << 8);
        assertEquals(0x373D, opcode);
    }

    @Test
    void overrideHoldsAndClears() {
        WeatherService.setSky(WeatherProfile.RAIN.id(), WeatherService.OVERRIDE_HOLD_MS);
        try {
            assertTrue(WeatherService.isOverridden());
            assertEquals(WeatherProfile.RAIN.id(), WeatherService.skyForMap(100000000));
        } finally {
            WeatherService.clearSkyOverride();
        }
        assertFalse(WeatherService.isOverridden());
    }

    @Test
    void combatScalarsOffByDefaultRegardlessOfClock() {
        // USE_WEATHER_GAMEPLAY_EFFECTS defaults false: all scalars are identity
        // at any clock. Zero/negative inputs never become positive either way.
        assertEquals(0, WeatherCombat.scaleDamageToMonster(0));
        assertEquals(-5, WeatherCombat.scaleDamageToMonster(-5));
        assertEquals(0, WeatherCombat.scaleDamageToPlayer(0));
        assertEquals(100, WeatherCombat.scaleDamageToPlayer(100));
        assertEquals(50, WeatherCombat.scaleExp(50));
        assertEquals(1.0, WeatherCombat.spawnMultiplier(), 0.0001);
        assertFalse(WeatherCombat.gameplayEnabled());
    }

    @Test
    void spawnMultiplierIsOneWhenGated() {
        // With the default-off flag, density never steps up — no clock dependence.
        assertEquals(1.0, WeatherCombat.spawnMultiplier(), 0.0001);
    }

    @Test
    void visibilityDefaultsClosed() {
        // Unregistered maps have no visible sky (safe default).
        assertFalse(WeatherMapVisibility.hasVisibleSky(Integer.MAX_VALUE - 7));
    }

    @Test
    void lampPacketShape() {
        Packet p = server.lamp.LampPackets.lampPreview(0, 3, 100000000, 100, 200);
        // 16 bytes: short opcode + byte mode + byte lamp + int map + int x + int y.
        assertEquals(16, p.getBytes().length);
        byte[] b = p.getBytes();
        int opcode = (b[0] & 0xFF) | ((b[1] & 0xFF) << 8);
        assertEquals(0x373F, opcode);
    }

    @Test
    void lampCatalogIsIndexAligned() {
        assertTrue(server.lamp.LampCatalog.size() > 0);
        assertTrue(server.lamp.LampCatalog.isValid(0));
        assertFalse(server.lamp.LampCatalog.isValid(-1));
        assertFalse(server.lamp.LampCatalog.isValid(server.lamp.LampCatalog.size()));
    }
}
