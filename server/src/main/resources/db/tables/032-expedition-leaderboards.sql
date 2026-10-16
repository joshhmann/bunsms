-- MapleRoot Database/CLEANDB.sql boss result/leaderboard schema only.
-- Existing attempt rows, quota enums and unrelated data remain unchanged.
ALTER TABLE bosslog_daily
    ADD COLUMN IF NOT EXISTS complete TINYINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS damage BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS duration BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS party_uuid CHAR(36) DEFAULT NULL;
ALTER TABLE bosslog_weekly
    ADD COLUMN IF NOT EXISTS complete TINYINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS damage BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS duration BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS party_uuid CHAR(36) DEFAULT NULL;
CREATE TABLE bosslog_leaderboard_daily (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    characterid INT NOT NULL,
    bosstype VARCHAR(32) NOT NULL,
    damage BIGINT NOT NULL DEFAULT 0,
    duration BIGINT NOT NULL DEFAULT 0,
    attempttime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    party_uuid CHAR(36) NOT NULL,
    UNIQUE KEY party_member (party_uuid, characterid),
    KEY boss_duration (bosstype, duration)
);
CREATE TABLE bosslog_leaderboard_weekly LIKE bosslog_leaderboard_daily;
