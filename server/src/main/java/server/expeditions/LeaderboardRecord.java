package server.expeditions;

import java.util.ArrayList;
import java.util.List;

/** A MapleRoot leaderboard entry represents one party, not one character. */
public final class LeaderboardRecord {
    private final String partyUuid;
    private final String formattedAttemptTime;
    private final String formattedCompletionTime;
    private final List<ExpeditionBossLogRecord> records = new ArrayList<>();

    public LeaderboardRecord(String partyUuid, String formattedAttemptTime, String formattedCompletionTime) {
        this.partyUuid = partyUuid;
        this.formattedAttemptTime = formattedAttemptTime;
        this.formattedCompletionTime = formattedCompletionTime;
    }

    public String getPartyUuid() { return partyUuid; }
    public String getFormattedAttemptTime() { return formattedAttemptTime; }
    public String getFormattedCompletionTime() { return formattedCompletionTime; }
    public void addRecord(ExpeditionBossLogRecord record) { records.add(record); }
    public List<ExpeditionBossLogRecord> getRecords() { return records; }
}
