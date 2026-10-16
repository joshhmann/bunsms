package server.life;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Monster long-HP domain contract (ticket #12 core): real domain objects, no
 * mocks. A high-HP monster (above 2^31) takes damage, heals, clamps, dies and
 * accounts contributions in long precision; normal-HP behavior is unchanged.
 */
class MonsterLongHpTest {

    private static Monster monsterWithHp(long hp) {
        MonsterStats stats = new MonsterStats();
        stats.setHp(hp);
        stats.setMp(100);
        stats.setExp(1000);
        stats.setLevel(50);
        return new Monster(1, stats);
    }

    @Test
    void highHpSurvivesIntMaxDamageAndTracksRemainder() {
        Monster mob = monsterWithHp(5_000_000_000L);
        Long dealt = mob.applyAndGetHpDamage(2_147_483_647L, false);
        assertEquals(2_147_483_647L, dealt);
        assertEquals(5_000_000_000L - 2_147_483_647L, mob.getHp());
        assertTrue(mob.isAlive());
    }

    @Test
    void overkillClampsToCurrentHp() {
        Monster mob = monsterWithHp(5_000_000_000L);
        Long dealt = mob.applyAndGetHpDamage(9_000_000_000L, false);
        assertEquals(5_000_000_000L, dealt);
        assertEquals(0L, mob.getHp());
        assertFalse(mob.isAlive());
    }

    @Test
    void setHpZeroKillsExtendedHp() {
        Monster mob = monsterWithHp(5_000_000_000L);
        mob.setHpZero();
        assertEquals(0L, mob.getHp());
        assertFalse(mob.isAlive());
    }

    @Test
    void healClampsAtMaxHp() {
        Monster mob = monsterWithHp(5_000_000_000L);
        mob.applyAndGetHpDamage(1_000_000_000L, false);
        Long healed = mob.applyAndGetHpDamage(-2_000_000_000L, false);
        assertEquals(1_000_000_000L, healed);
        assertEquals(5_000_000_000L, mob.getHp());
        assertEquals(5_000_000_000L, mob.getMaxHp());
    }

    @Test
    void deadMonsterReturnsNull() {
        Monster mob = monsterWithHp(100L);
        mob.applyAndGetHpDamage(100L, false);
        assertNull(mob.applyAndGetHpDamage(10L, false));
    }

    @Test
    void stayAliveReservesOneHp() {
        Monster mob = monsterWithHp(100L);
        Long dealt = mob.applyAndGetHpDamage(500L, true);
        assertEquals(99L, dealt);
        assertEquals(1L, mob.getHp());
        assertTrue(mob.isAlive());
    }

    @Test
    void normalHpBehaviorUnchanged() {
        Monster mob = monsterWithHp(10_000L);
        assertEquals(4_000L, mob.applyAndGetHpDamage(4_000L, false));
        assertEquals(6_000L, mob.getHp());
        assertEquals(2_500L, mob.applyAndGetHpDamage(-2_500L, false));
        assertEquals(8_500L, mob.getHp());
    }

    @Test
    void hpCapConstantIs2To53() {
        assertEquals(9007199254740992L, Monster.MAX_MONSTER_HP);
    }

    @Test
    void statsHoldLongHp() {
        MonsterStats stats = new MonsterStats();
        stats.setHp(5_000_000_000L);
        assertEquals(5_000_000_000L, stats.getHp());
        Monster mob = new Monster(1, stats);
        assertEquals(5_000_000_000L, mob.getHp());
        assertEquals(5_000_000_000L, mob.getMaxHp());
    }

    @Test
    void statsCopyPreservesLongHp() {
        MonsterStats stats = new MonsterStats();
        stats.setHp(5_000_000_000L);
        assertEquals(5_000_000_000L, stats.copy().getHp());
    }
}
