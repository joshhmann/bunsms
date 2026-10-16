/*
 This file is part of the OdinMS Maple Story Server
 Copyright (C) 2008 Patrick Huy <patrick.huy@frz.cc>
 Matthias Butz <matze@odinms.de>
 Jan Christian Meyer <vimes@odinms.de>

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
package scripting.portal;

import client.Client;
import scripting.AbstractPlayerInteraction;
import scripting.map.MapScriptManager;
import server.maps.Portal;
import tools.DatabaseConnection;
import tools.PacketCreator;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

public class PortalPlayerInteraction extends AbstractPlayerInteraction {
    private final Portal portal;

    public PortalPlayerInteraction(Client c, Portal portal) {
        super(c);
        this.portal = portal;
    }

    public Portal getPortal() {
        return portal;
    }

    public void runMapScript() {
        MapScriptManager msm = MapScriptManager.getInstance();
        msm.runMapScript(c, "onUserEnter/" + portal.getScriptName(), false);
    }

    public boolean hasLevel30Character() {
        try (Connection con = DatabaseConnection.getConnection();
             PreparedStatement ps = con.prepareStatement("SELECT `level` FROM `characters` WHERE accountid = ?")) {
            ps.setInt(1, getPlayer().getAccountID());

            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    if (rs.getInt("level") >= 30) {
                        return true;
                    }
                }
            }
        } catch (SQLException sqle) {
            sqle.printStackTrace();
        }

        return getPlayer().getLevel() >= 30;
    }

    public void blockPortal() {
        c.getPlayer().blockPortal(getPortal().getScriptName());
    }

    public void unblockPortal() {
        c.getPlayer().unblockPortal(getPortal().getScriptName());
    }

    public void playPortalSound() {
        c.sendPacket(PacketCreator.playPortalSound());
    }

    // Boss-pack Wave 0 (DKBONUS1/YOSHIJQ entry doors): hour-cycle gate ported
    // from MapleRoot so DKC2Bonus1.js/YOSHIJQ1.js resolve at runtime.
    private static final int START_HOUR = 0;
    private static final int CYCLE_MINUTES = 60;
    private static final int WINDOW_DURATION = 5;

    public boolean isDoorOpen() {
        long totalMinutes = System.currentTimeMillis() / (1000 * 60);
        long minutesInCurrentCycle = (totalMinutes - (long) START_HOUR * 60) % CYCLE_MINUTES;
        return minutesInCurrentCycle >= 0 && minutesInCurrentCycle < WINDOW_DURATION;
    }

    public long timeUntilNextOpen() {
        long totalMinutes = System.currentTimeMillis() / (1000 * 60);
        long minutesInCurrentCycle = (totalMinutes - (long) START_HOUR * 60) % CYCLE_MINUTES;
        if (minutesInCurrentCycle < WINDOW_DURATION) {
            return 0;
        }
        return CYCLE_MINUTES - minutesInCurrentCycle;
    }
}