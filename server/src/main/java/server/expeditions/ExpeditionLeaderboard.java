package server.expeditions;

import tools.DatabaseConnection;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

/** MapleRoot's party-clear leaderboard, using this server's configured database. */
public final class ExpeditionLeaderboard {
    private ExpeditionLeaderboard() {}

    static String table(ExpeditionBossLog.BossLogEntry boss) {
        return boss.getIsWeekly() ? "bosslog_leaderboard_weekly" : "bosslog_leaderboard_daily";
    }

    public static List<LeaderboardRecord> getGlobalLeaderboardForBoss(ExpeditionBossLog.BossLogEntry boss) {
        return read(boss, null);
    }

    public static List<LeaderboardRecord> getPersonalLeaderboardForBoss(int characterId, ExpeditionBossLog.BossLogEntry boss) {
        return read(boss, characterId);
    }

    private static List<LeaderboardRecord> read(ExpeditionBossLog.BossLogEntry boss, Integer characterId) {
        List<LeaderboardRecord> result = new ArrayList<>();
        String table = table(boss);
        String parties = "SELECT party_uuid, MIN(duration) AS duration, "
                + "DATE_FORMAT(MIN(attempttime), '%M %d, %Y') AS attempt_date FROM " + table
                + " WHERE bosstype = ?" + (characterId == null ? "" : " AND characterid = ?")
                + " GROUP BY party_uuid ORDER BY duration, party_uuid LIMIT " + (characterId == null ? 10 : 3);
        String members = "SELECT * FROM " + table
                + " WHERE party_uuid = ? AND bosstype = ? ORDER BY damage DESC, characterid";
        try (Connection con = DatabaseConnection.getConnection();
             PreparedStatement top = con.prepareStatement(parties);
             PreparedStatement partyMembers = con.prepareStatement(members)) {
            top.setString(1, boss.name());
            if (characterId != null) {
                top.setInt(2, characterId);
            }
            try (ResultSet rows = top.executeQuery()) {
                while (rows.next()) {
                    result.add(new LeaderboardRecord(rows.getString("party_uuid"), rows.getString("attempt_date"),
                            formatDuration(rows.getLong("duration"))));
                }
            }
            for (LeaderboardRecord party : result) {
                partyMembers.setString(1, party.getPartyUuid());
                partyMembers.setString(2, boss.name());
                try (ResultSet rows = partyMembers.executeQuery()) {
                    while (rows.next()) {
                        int memberId = rows.getInt("characterid");
                        String memberName = rows.getString("character_name");
                        party.addRecord(new ExpeditionBossLogRecord(rows.getInt("id"), memberId,
                                memberName == null ? "[unavailable character " + memberId + "]" : memberName,
                                boss.name(), rows.getTimestamp("attempttime"), rows.getLong("damage"),
                                rows.getLong("duration"), party.getPartyUuid(), true));
                    }
                }
            }
        } catch (SQLException ex) {
            throw new IllegalStateException("Unable to read expedition leaderboard for " + boss, ex);
        }
        return result;
    }

    public static String getGlobalLeaderboardStringForBoss(ExpeditionBossLog.BossLogEntry boss) {
        return format(boss, getGlobalLeaderboardForBoss(boss), "Top 10");
    }

    public static String getPersonalLeaderboardStringForBoss(int characterId, ExpeditionBossLog.BossLogEntry boss) {
        return format(boss, getPersonalLeaderboardForBoss(characterId, boss), "Your top 3");
    }

    private static String format(ExpeditionBossLog.BossLogEntry boss, List<LeaderboardRecord> records, String heading) {
        StringBuilder text = new StringBuilder(heading).append(" fastest parties to clear #e#r")
                .append(boss.name()).append("#n#k:\r\n");
        if (records.isEmpty()) {
            return text.append("No available entries at this time.").toString();
        }
        int rank = 1;
        for (LeaderboardRecord party : records) {
            text.append(rank++).append(". ").append(party.getRecords().stream()
                    .map(member -> "#b" + member.getCharacterName() + "#k")
                    .collect(Collectors.joining(", "))).append("\r\n    Completion time: #b")
                    .append(party.getFormattedCompletionTime()).append("#k on ")
                    .append(party.getFormattedAttemptTime()).append(".\r\n");
            for (ExpeditionBossLogRecord member : party.getRecords()) {
                text.append("    ").append(member.getCharacterName()).append(": ")
                        .append(member.getDamageDealt()).append(" damage\r\n");
            }
        }
        return text.toString();
    }

    private static String formatDuration(long millis) {
        return (millis / 60000) + "m " + ((millis / 1000) % 60) + "s " + (millis % 1000) + "ms";
    }
}
