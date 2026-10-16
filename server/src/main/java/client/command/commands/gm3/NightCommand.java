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
package client.command.commands.gm3;

import client.Character;
import client.Client;
import client.command.Command;
import server.weather.WeatherPackets;
import server.weather.WeatherService;

/**
 * {@code !night} — freeze the world clock at night (weather/time system) and also
 * fire the legacy stock-Augur black-sky background effect on the current map.
 *
 * <p>MERGED (ticket #13): this path previously did ONLY the stock-Augur
 * {@code broadcastNightEffect()} on the current map. The weather bundle ships its own
 * world-clock {@code NightCommand} at the same path (freeze at
 * {@link WeatherService#TIME_NIGHT}, broadcast). Rename was rejected: {@code !night}
 * is the documented GM name on both sides. The merged command keeps both behaviours:
 * the caller's map gets the instant legacy black-sky background, and the world clock
 * freezes at night until {@code !weather auto} or the hold lapses.
 */
public class NightCommand extends Command {
    {
        setDescription("Freeze the world at night (+ legacy black-sky background here).");
    }

    @Override
    public void execute(Client c, String[] params) {
        Character player = c.getPlayer();
        // Legacy stock-Augur behaviour: instant black-sky background on this map.
        player.getMap().broadcastNightEffect();
        // Weather world-clock behaviour: freeze the shared clock at night.
        WeatherService.setBareSky(false);
        WeatherService.setTime(WeatherService.TIME_NIGHT);
        WeatherPackets.broadcast(c.getWorldServer(), false);
        player.yellowMessage("World time set to night. Use !weather auto to resume it.");
    }
}
