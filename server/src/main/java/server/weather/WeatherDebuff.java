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

import client.BuffStat;
import client.Character;
import net.server.world.World;
import server.StatEffect;
import tools.Pair;

import java.util.List;

/**
 * Walking into a blizzard slows you down, visibly.
 *
 * <h2>Why this is a real buff and not a server-side number</h2>
 *
 * Movement speed is applied entirely client side. {@code Character.updateLocalStats} does
 * not read {@code BuffStat.SPEED} at all -- the block that would is commented out -- so a
 * value the server merely stored would move nothing. This is the same finding the Phantom
 * Step affix records, and the same answer: hand it to {@code StatEffect}, which registers
 * the stat against a source id, sends the GIVE_BUFF, schedules the expiry, sends the
 * cancel, and restores whatever weaker SPEED effect was underneath when it lapses. A
 * hand-rolled packet would move the client and leave the server's bookkeeping ignorant.
 *
 * <p>It also replaces {@code weathermove.cpp}'s walk-speed half. That wrote the client's
 * physics table directly, which could never appear in the stat window because the stat
 * window reads the character's speed stat and the physics table is not it. Doing it as a
 * stat solves both halves at once. The FRICTION half of weathermove stays where it is:
 * poor footing on settled snow genuinely is not a stat and has nowhere else to live.
 *
 * <h2>The icon is an item id, not a skill</h2>
 *
 * {@code StatEffect.createFamiliarEffect} sets {@code sourceid} to an ITEM id with
 * {@code skill = false}, and the client draws that item's icon in the buff bar. It also
 * reads the buff's TOOLTIP out of the same id, which is the reason {@link #SOURCE_ITEM_ID}
 * is a private id of our own rather than a borrowed one: borrowing the icon meant borrowing
 * the lender's description with it. The icon is still the snowflake cluster, copied across,
 * because it is the most legible of the snow candidates at the 32x32 the buff bar draws.
 */
public final class WeatherDebuff {

    /** Speed points removed while a blizzard is overhead. Negative on purpose. */
    public static final int BLIZZARD_SPEED = -10;

    /**
     * The buff's identity, {@code Item/Cash/0512.img/05120994}.
     *
     * <p>{@code sourceid} is what the client looks BOTH the buff icon and the buff TOOLTIP
     * up by, and that is why this is a private id rather than a borrowed one. It used to
     * point at 05120003, Snowflakes, purely for its snowflake icon, and the tooltip came
     * with it: hovering the debuff described a consumable the player does not have and
     * said nothing about being slowed.
     *
     * <p>Editing 05120003's description was not the fix. It is a real, obtainable cash
     * item, so its string belongs to the item and rewriting it would put debuff text in
     * the cash shop. 05120994 instead COPIES that icon and carries its own name and
     * description, added by {@code add_weather_debuff_item.py}.
     *
     * <p>Deliberately has no {@code path}, {@code type} or {@code floatType}, which are the
     * three fields that make a 0512 id blowable as weather, and is deliberately absent from
     * the server's item data. Nothing is consumed and the player never holds one.
     */
    public static final int SOURCE_ITEM_ID = 5120994;

    /**
     * How long each application lasts.
     *
     * <p>Longer than {@code WeatherTask.INTERVAL_MS} on purpose. The refresh rides that
     * tick, so a duration equal to it would leave a gap every minute in which the player
     * is briefly un-slowed and the icon blinks. The overhang covers a late tick.
     */
    public static final int DURATION_MS = 75 * 1000;

    private WeatherDebuff() {
    }

    /**
     * Is the sky over this map one that should slow the player?
     *
     * <p>Gated on {@link WeatherMapVisibility#hasVisibleSky(int)} for the same reason
     * the shared rule is: a map the client renders no weather on must
     * not hand the player a debuff and a buff icon for weather they cannot see. Without
     * this term a blizzard slows everyone in the caves and interiors of the region too.
     */
    private static boolean slows(int mapId) {
        return WeatherMapVisibility.hasVisibleSky(mapId)
                && WeatherService.skyForMap(mapId) == WeatherProfile.BLIZZARD.id();
    }

    /**
     * Apply or refresh the slow for one player, or let it lapse if they are no longer in
     * it.
     *
     * <p>NOT CANCELLED EXPLICITLY when the blizzard ends, and that is deliberate. The
     * cancel path would have to know it was ours, and a mistake there clears a Haste the
     * player is paying for. Letting it lapse costs at most one refresh period of slow
     * after the snow stops, which reads as the weather easing rather than as a bug.
     */
    public static void refresh(Character chr) {
        if (chr == null || !chr.isLoggedinWorld() || !chr.isAlive()) {
            return;
        }
        if (!slows(chr.getMapId())) {
            return;
        }
        try {
            if (chr.refreshTimedItemBuff(SOURCE_ITEM_ID, DURATION_MS)) {
                return;
            }
            StatEffect.createFamiliarEffect(SOURCE_ITEM_ID, DURATION_MS,
                            List.of(new Pair<>(BuffStat.SPEED, BLIZZARD_SPEED)))
                    .applyTo(chr);
        } catch (Exception e) {
            // applyTo dereferences the character's map, and a character mid map change is
            // what reaches here. A missed slow must never cost the caller its own work:
            // this is called from the weather broadcast loop, and a throw would abandon
            // every player after it in the tick.
            LOG.warn("blizzard slow failed for {}", chr.getName(), e);
        }
    }

    /** Every player in the world, from the weather broadcast tick. */
    public static void refreshAll(World world) {
        if (world == null || world.getPlayerStorage() == null) {
            return;
        }
        for (Character chr : world.getPlayerStorage().getAllCharacters()) {
            refresh(chr);
        }
    }

    private static final org.slf4j.Logger LOG =
            org.slf4j.LoggerFactory.getLogger(WeatherDebuff.class);
}
