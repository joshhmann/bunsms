package server.expeditions;

import org.junit.jupiter.api.Test;

import java.util.EnumSet;
import java.util.HashSet;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Punch-list #3: Wave 0 boss-pack coverage.
 *
 * <p>Pins the additive Wave 0 surface so a future cleanup cannot silently drop
 * (or duplicate) an entry: total counts plus the full BossLog name set that
 * migration 029 widens the {@code bosstype} ENUM to accept.
 */
class ExpeditionWave0Test {

    @Test
    void expeditionTypeCount() {
        // Pre-Wave-0 had 13 entries (through CWKPQ); Wave 0 adds 18.
        assertEquals(31, ExpeditionType.values().length);
    }

    @Test
    void wave0ExpeditionEntriesExist() {
        for (String name : new String[]{
                "VONLEON", "CYGNUS", "WILLSPIDER", "VERUS", "DARKNELL",
                "KREXEL", "CASTELLAN", "LUCID",
                "NORMALLOTUS", "HARDLOTUS",
                "EASYMAGNUS", "NORMALMAGNUS", "HARDMAGNUS",
                "NWILLSPIDER", "NLUCID", "NVERUS", "NDARKNELL", "MAGNUS"}) {
            ExpeditionType.valueOf(name);
        }
    }

    @Test
    void bossLogEntryCount() {
        // Pre-Wave-0 had 5 entries; Wave 0 grows the log to 18.
        assertEquals(18, ExpeditionBossLog.BossLogEntry.values().length);
    }

    @Test
    void bossLogNamesMatch029EnumWiden() {
        Set<String> names = new HashSet<>();
        for (ExpeditionBossLog.BossLogEntry e : ExpeditionBossLog.BossLogEntry.values()) {
            names.add(e.name());
        }
        assertEquals(EnumSet.allOf(ExpeditionBossLog.BossLogEntry.class).size(), names.size());
        assertTrue(names.containsAll(Set.of(
                "ZAKUM", "HORNTAIL", "PINKBEAN", "SCARGA", "PAPULATUS",
                "VONLEON", "CYGNUS", "WILLSPIDER", "VERUS", "DARKNELL",
                "KREXEL", "CASTELLAN", "LUCID", "NLUCID", "NWILLSPIDER",
                "NVERUS", "NDARKNELL", "MAGNUS")));
    }

    @Test
    void bossLogIndexesAreUniqueOneBased() {
        Set<Integer> indexes = new HashSet<>();
        for (ExpeditionBossLog.BossLogEntry e : ExpeditionBossLog.BossLogEntry.values()) {
            indexes.add(e.getIndex());
        }
        assertEquals(ExpeditionBossLog.BossLogEntry.values().length, indexes.size());
        for (int i = 1; i <= ExpeditionBossLog.BossLogEntry.values().length; i++) {
            assertTrue(indexes.contains(i), "missing BossLogEntry index " + i);
        }
    }

    @Test
    void castellanCodePathResolves() {
        // Punch-list #3 keep-decision: the minimal Castellan code path exists —
        // ExpeditionType + BossLogEntry share the name so attemptBoss() maps it.
        ExpeditionType exped = ExpeditionType.valueOf("CASTELLAN");
        ExpeditionBossLog.BossLogEntry boss =
                ExpeditionBossLog.BossLogEntry.valueOf(exped.name());
        assertEquals("CASTELLAN", boss.name());
        assertEquals(20, boss.getEntries());
    }
}
