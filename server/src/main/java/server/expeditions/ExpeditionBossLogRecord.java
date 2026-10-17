package server.expeditions;

import java.sql.Timestamp;

/** Persistent MapleRoot expedition result, shared by personal and global boards. */
public final class ExpeditionBossLogRecord {
    private final int id;
    private final int characterId;
    private final String characterName;
    private final String bossType;
    private final Timestamp attemptTime;
    private final long damageDealt;
    private final long duration;
    private final String partyUuid;
    private final boolean complete;

    public ExpeditionBossLogRecord(int id, int characterId, String characterName, String bossType,
                                   Timestamp attemptTime, long damageDealt, long duration,
                                   String partyUuid, boolean complete) {
        this.id = id;
        this.characterId = characterId;
        this.characterName = characterName;
        this.bossType = bossType;
        this.attemptTime = attemptTime;
        this.damageDealt = damageDealt;
        this.duration = duration;
        this.partyUuid = partyUuid;
        this.complete = complete;
    }

    public int getId() { return id; }
    public int getCharacterId() { return characterId; }
    public String getCharacterName() { return characterName; }
    public String getBossType() { return bossType; }
    public Timestamp getAttemptTime() { return attemptTime; }
    public long getDamageDealt() { return damageDealt; }
    public long getDuration() { return duration; }
    public String getPartyUuid() { return partyUuid; }
    public boolean isComplete() { return complete; }
}
