/*
    This file is part of the HeavenMS MapleStory Server, commands OdinMS-based
    Copyleft (L) 2016 - 2019 RonanLana

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

/*
   @Author: Arthur L - Refactored command content into modules
*/
package client.command.commands.gm0;

import client.Character;
import client.Client;
import client.command.Command;
import server.DailyCheckinRewards;
import tools.PacketCreator;

/**
 * @checkin / @daily — opens the Daily Check-In window (DLL-side). refreshCheckin() is idempotent
 * (keyed by the 24h timestamp), so running this any time is safe; sending the snapshot opens the
 * window even when there's nothing to claim yet (and reports the remaining cooldown).
 */
public class CheckinCommand extends Command {
    {
        setDescription("Open the Daily Check-In window.");
    }

    @Override
    public void execute(Client c, String[] params) {
        Character player = c.getPlayer();
        if (player.getLevel() < DailyCheckinRewards.MIN_LEVEL) {
            player.dropMessage(6, "Daily Check-In unlocks at Level " + DailyCheckinRewards.MIN_LEVEL + ".");
            return;
        }
        if (!c.hasCaps(client.ClientCaps.CHECKIN_WINDOW)) {
            player.dropMessage(6, "Daily Check-In requires a compatible BunsMS client.");
            return;
        }
        int claimable = player.refreshCheckin();
        int viewDay = claimable >= 1 ? claimable : player.getCheckinDay();
        c.sendPacket(PacketCreator.dailyCheckinSnapshot(viewDay, player.getCheckinClaimed(), 0));
        if (claimable < 1) {
            long secs = player.getCheckinCooldownSeconds();
            long h = secs / 3600, m = (secs % 3600) / 60;
            player.dropMessage(6, "Daily Check-In: your next reward unlocks in " + h + "h " + m + "m.");
        }
    }
}
