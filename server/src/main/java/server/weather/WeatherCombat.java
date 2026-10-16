/*
    This file is part of a Maple Story Server and is redistributed under the
    licence below

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as
    published by the Free Software Foundation version 3 as published by
    the Free Software Foundation. You may not use, modify or distribute
    this program under any other version of the GNU Affero General Public
    License.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/
package server.weather;


/**
 * What the sky quietly does to combat.
 *
 * <p><b>This is deliberately invisible.</b> Nothing here sends a packet, writes a chat
 * line, sets a buff icon or shows a number. There is no announcement, no tooltip and no
 * indicator anywhere in the tree: a player can only infer these by playing. Keep it that
 * way, and do not add a "weather bonus" message later without deciding that on purpose.
 *
 * <h2>Why these are applied damage scalars and not stat changes</h2>
 *
 * This client owns the damage line. The player's client computes every damage number,
 * including the damage the player TAKES, and sends it up; the server applies and
 * validates it. So there is no server-side "monster WDEF" or "skill power" to raise:
 * changing a mob's defence server-side would not alter the number the client already
 * decided on, and changing it client-side would need a DLL cave and would visibly shrink
 * the floating numbers.
 *
 * <p>Scaling what the server APPLIES is therefore the only silent lever. The consequence
 * is worth being clear about, because it is the whole design tradeoff:
 *
 * <ul>
 *   <li>the floating damage number a player sees is UNCHANGED</li>
 *   <li>the HP actually removed is scaled</li>
 * </ul>
 *
 * So at night a mob whose hit reads 100 removes 110, and a mob that took 100 loses 91.
 * That is invisible in normal play and detectable only by someone counting hits against a
 * known HP pool. That is exactly the "silent" that was asked for; a version where the
 * numbers matched would require the client to know about the weather, which would make it
 * announce itself.
 *
 * <h2>Night is global</h2>
 *
 * The clock is world-wide, so these apply on every map, not only the 2931 with a visible
 * sky. A cave being more dangerous at night is a defensible fiction and it avoids porting
 * the client's sky classifier to the server for no gameplay gain.
 */
public final class WeatherCombat {

    private WeatherCombat() {
    }

    // ---------------------------------------------------------------- tunables

    /** Night is "in force" above this on the 0..1 curve, i.e. from roughly 18:00 to 06:00. */
    private static final float NIGHT_THRESHOLD = 0.5f;

    /** Monsters hit this much harder at night. */
    private static final double NIGHT_MOB_DAMAGE = 1.10;

    /**
     * Monsters effectively have this much more defence at night, expressed as the share of
     * incoming damage that lands. 1/1.10, so "10% more defence" in outcome.
     */
    private static final double NIGHT_MOB_DEFENCE = 1.0 / 1.10;

    /** Experience from a kill at night. */
    private static final double NIGHT_EXP = 1.15;

    /** Mob density multiplier at night, folded into MapleMap.getSpawnRateMultiplier(). */
    private static final double NIGHT_SPAWN = 1.35;

    // ---------------------------------------------------------------- state

    public static boolean isNight() {
        return WeatherService.nightLevel() > NIGHT_THRESHOLD;
    }

    // ---------------------------------------------------------------- scalars

    /**
     * Night defence: the monster takes less of what the player dealt.
     *
     * <p>Applied at the single HP write in {@code MapleMap.damageMonster}, which is where
     * every player-attributed damage source converges.
     *
     * <p><b>Deliberately takes no skill.</b> The element bonus is a SEPARATE method
     * applied at a different site, and the two must not be reachable from one call: an
     * earlier version combined them here and, because both sites run for a normal attack,
     * the night term landed twice and produced 21% defence instead of 10%. Keeping each
     * term in exactly one method makes that mistake impossible rather than merely
     * documented.
     */
    public static int scaleDamageToMonster(int damage) {
        if (damage <= 0 || !gameplayEnabled() || !isNight()) {
            return damage;
        }
        return apply(damage, NIGHT_MOB_DEFENCE);
    }

    /**
     * Master switch for ALL silent weather gameplay (damage/EXP/spawn/debuff/
     * nocturnal). Default false; sky packets are unaffected (separate caps).
     */
    public static boolean gameplayEnabled() {
        try {
            return config.YamlConfig.config.server.USE_WEATHER_GAMEPLAY_EFFECTS;
        } catch (Exception e) {
            return false;
        }
    }

    /** Scale damage a monster deals to a player. */
    public static int scaleDamageToPlayer(int damage) {
        if (damage <= 0 || !gameplayEnabled()) {
            return damage;
        }
        return isNight() ? apply(damage, NIGHT_MOB_DAMAGE) : damage;
    }

    /** Scale the experience a kill awards. */
    public static int scaleExp(int exp) {
        if (exp <= 0 || !gameplayEnabled()) {
            return exp;
        }
        return isNight() ? apply(exp, NIGHT_EXP) : exp;
    }

    /**
     * Mob density multiplier: gameplay-gated like the other scalars (1.0 when
     * the flag is off, regardless of clock).
     */
    public static double spawnMultiplier() {
        return gameplayEnabled() && isNight() ? NIGHT_SPAWN : 1.0;
    }

    // ---------------------------------------------------------------- internals

    /**
     * Multiply and round, never letting a positive value become zero.
     *
     * <p>The floor matters: a 1 damage hit scaled by 0.909 truncates to 0, which the rest
     * of the server reads as a MISS. That would turn the night defence bump into
     * "1 damage attacks stop registering", which is both wrong and very visible.
     */
    private static int apply(int value, double factor) {
        long scaled = Math.round(value * factor);
        if (scaled < 1L) {
            scaled = 1L;
        }
        if (scaled > Integer.MAX_VALUE) {
            scaled = Integer.MAX_VALUE;
        }
        return (int) scaled;
    }
}
