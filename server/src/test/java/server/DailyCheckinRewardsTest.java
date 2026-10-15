package server;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Daily Check-In reward-table invariants. Runs without WZ/DB: {@link DailyCheckinRewards#tooltip}
 * degrades to "Item &lt;id&gt;" when String.wz is unavailable, so only shape/content invariants
 * are asserted here (never exact item names).
 */
class DailyCheckinRewardsTest {

    @Test
    void cycleHas28Days() {
        assertEquals(28, DailyCheckinRewards.CYCLE_DAYS);
    }

    @Test
    void outOfRangeDaysAreRejected() {
        assertFalse(DailyCheckinRewards.grantDay(null, 0));
        assertFalse(DailyCheckinRewards.grantDay(null, 29));
        assertEquals(0, DailyCheckinRewards.iconItemId(0));
        assertEquals(0, DailyCheckinRewards.iconItemId(29));
        assertEquals("", DailyCheckinRewards.tooltip(0));
        assertEquals("", DailyCheckinRewards.tooltip(29));
    }

    @Test
    void everyDayHasIconAndTooltip() {
        for (int d = 1; d <= DailyCheckinRewards.CYCLE_DAYS; d++) {
            assertTrue(DailyCheckinRewards.iconItemId(d) > 0, "day " + d + " has no icon");
            String tip = DailyCheckinRewards.tooltip(d);
            assertTrue(tip.startsWith("Day " + d), "day " + d + " tooltip header wrong: " + tip);
            assertTrue(tip.contains("mesos"), "day " + d + " mock tooltip should mention mesos: " + tip);
        }
    }
}
