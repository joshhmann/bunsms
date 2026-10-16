/*
    This file is part of the HeavenMS MapleStory Server
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
package server.expeditions;

import config.YamlConfig;
import tools.DatabaseConnection;
import tools.Pair;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.Calendar;
import java.util.LinkedList;
import java.util.List;

import static java.util.concurrent.TimeUnit.DAYS;
import static java.util.concurrent.TimeUnit.HOURS;

/**
 * @author Conrad
 * @author Ronan
 */
public class ExpeditionBossLog {

    public enum BossLogEntry {
        ZAKUM(1, 5, 25, 24, false),
        HORNTAIL(2, 6, 20, 24, false),
        PINKBEAN(3, 7, 20, 24, false),
        SCARGA(4, 1, 10, 24, false),
        PAPULATUS(5, 2, 30, 24, false),
        VONLEON(6, 8, 18, 24, false),
        CYGNUS(7, 9, 16, 24, false),
        WILLSPIDER(8, 11, 8, 24, false),
        VERUS(9, 12, 8, 24, false),
        DARKNELL(10, 13, 8, 24, false),
        KREXEL(11, 3, 20, 24, false),
        CASTELLAN(12, 4, 20, 24, false),
        LUCID(13, 10, 8, 24, false),
        NLUCID(14, 10, 12, 24, false),
        NWILLSPIDER(15, 10, 12, 24, false),
        NVERUS(16, 10, 12, 24, false),
        NDARKNELL(17, 10, 12, 24, false),
        MAGNUS(18, 10, 8, 24, false);

        private final int entries;
        private final int ordinal;
        private final int timeLength;
        private final int minChannel;
        private final int maxChannel;
        private final boolean week;
        private final int index;

        BossLogEntry(int index, int ordinal, int entries, int timeLength, boolean week) {
            this(index, ordinal, entries, 0, Integer.MAX_VALUE, timeLength, week);
        }

        BossLogEntry(int index, int ordinal, int entries, int minChannel, int maxChannel, int timeLength, boolean week) {
            this.index = index;
            this.ordinal = ordinal;
            this.entries = entries;
            this.minChannel = minChannel;
            this.maxChannel = maxChannel;
            this.timeLength = timeLength;
            this.week = week;
        }

        public int getIndex() { return this.index; }
        public int getEntries() { return this.entries; }
        public int getOrdinal() { return this.ordinal; }
        public boolean getIsWeekly() { return this.week; }

        private static List<Pair<Timestamp, BossLogEntry>> getBossLogResetTimestamps(Calendar timeNow, boolean week) {
            List<Pair<Timestamp, BossLogEntry>> resetTimestamps = new LinkedList<>();

            Timestamp ts = new Timestamp(timeNow.getTime().getTime());  // reset all table entries actually, thanks Conrad
            for (BossLogEntry b : BossLogEntry.values()) {
                if (b.week == week) {
                    resetTimestamps.add(new Pair<>(ts, b));
                }
            }

            return resetTimestamps;
        }

        private static BossLogEntry getBossEntryByName(String name) {
            for (BossLogEntry b : BossLogEntry.values()) {
                if (name.contentEquals(b.name())) {
                    return b;
                }
            }

            return null;
        }

    }

    public static void resetBossLogTable() {
        /*
        Boss logs resets 12am, weekly thursday 12AM - thanks Smitty Werbenjagermanjensen (superadlez) - https://www.reddit.com/r/Maplestory/comments/61tiup/about_reset_time/
        */

        Calendar thursday = Calendar.getInstance();
        thursday.set(Calendar.DAY_OF_WEEK, Calendar.THURSDAY);
        thursday.set(Calendar.HOUR, 0);
        thursday.set(Calendar.MINUTE, 0);
        thursday.set(Calendar.SECOND, 0);

        Calendar now = Calendar.getInstance();

        long weekLength = DAYS.toMillis(7);
        long halfDayLength = HOURS.toMillis(12);

        long deltaTime = now.getTime().getTime() - thursday.getTime().getTime();    // 2x time: get Date into millis
        deltaTime += halfDayLength;
        deltaTime %= weekLength;
        deltaTime -= halfDayLength;

        if (deltaTime < halfDayLength) {
            ExpeditionBossLog.resetBossLogTable(true, thursday);
        }

        now.set(Calendar.HOUR, 0);
        now.set(Calendar.MINUTE, 0);
        now.set(Calendar.SECOND, 0);

        ExpeditionBossLog.resetBossLogTable(false, now);
    }

    private static void resetBossLogTable(boolean week, Calendar c) {
        List<Pair<Timestamp, BossLogEntry>> resetTimestamps = BossLogEntry.getBossLogResetTimestamps(c, week);

        try (Connection con = DatabaseConnection.getConnection()) {
            for (Pair<Timestamp, BossLogEntry> p : resetTimestamps) {
                try (PreparedStatement ps = con.prepareStatement("DELETE FROM " + getBossLogTable(week) + " WHERE attempttime <= ? AND bosstype LIKE ?")) {
                    ps.setTimestamp(1, p.getLeft());
                    ps.setString(2, p.getRight().name());
                    ps.executeUpdate();
                }
            }
        } catch (SQLException e) {
            e.printStackTrace();
        }
    }

    private static String getBossLogTable(boolean week) {
        return week ? "bosslog_weekly" : "bosslog_daily";
    }

    public static int getPlayerEntryCount(int cid, BossLogEntry boss) {
        return countPlayerEntries(cid, boss);
    }

    private static int countPlayerEntries(int cid, BossLogEntry boss) {
        int ret_count = 0;
        try (Connection con = DatabaseConnection.getConnection();
             PreparedStatement ps = con.prepareStatement("SELECT COUNT(*) FROM " + getBossLogTable(boss.week) + " WHERE characterid = ? AND bosstype LIKE ?")) {
            ps.setInt(1, cid);
            ps.setString(2, boss.name());

            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) {
                    ret_count = rs.getInt(1);
                } else {
                    ret_count = -1;
                }
            }
            return ret_count;
        } catch (SQLException e) {
            e.printStackTrace();
            return -1;
        }
    }

    private static void insertPlayerEntry(int cid, BossLogEntry boss) {
        try (Connection con = DatabaseConnection.getConnection();
             PreparedStatement ps = con.prepareStatement("INSERT INTO " + getBossLogTable(boss.week) + " (characterid, bosstype) VALUES (?,?)")) {
            ps.setInt(1, cid);
            ps.setString(2, boss.name());
            ps.executeUpdate();
        } catch (SQLException e) {
            e.printStackTrace();
        }
    }

    public static boolean attemptBoss(int cid, int channel, Expedition exped, boolean log) {
        if (!YamlConfig.config.server.USE_ENABLE_DAILY_EXPEDITIONS) {
            return true;
        }

        BossLogEntry boss = BossLogEntry.getBossEntryByName(exped.getType().name());
        if (boss == null) {
            return true;
        }

        if (channel < boss.minChannel || channel > boss.maxChannel) {
            return false;
        }

        if (countPlayerEntries(cid, boss) >= boss.entries) {
            return false;
        }

        if (log) {
            insertPlayerEntry(cid, boss);
        }
        return true;
    }
}
