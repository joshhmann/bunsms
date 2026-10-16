-- MapleRoot Database/CLEANDB.sql boss result/leaderboard schema only.
-- Existing attempt rows, quota enums and unrelated data remain unchanged.
-- MySQL 8 has no ADD COLUMN IF NOT EXISTS. Use the established 026 guards.
SET @__has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bosslog_daily' AND COLUMN_NAME = 'complete');
SET @__alter_sql := IF(@__has_col = 0, 'ALTER TABLE bosslog_daily ADD COLUMN complete TINYINT NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE __alter_stmt FROM @__alter_sql;
EXECUTE __alter_stmt;
DEALLOCATE PREPARE __alter_stmt;
SET @__has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bosslog_daily' AND COLUMN_NAME = 'damage');
SET @__alter_sql := IF(@__has_col = 0, 'ALTER TABLE bosslog_daily ADD COLUMN damage BIGINT NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE __alter_stmt FROM @__alter_sql;
EXECUTE __alter_stmt;
DEALLOCATE PREPARE __alter_stmt;
SET @__has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bosslog_daily' AND COLUMN_NAME = 'duration');
SET @__alter_sql := IF(@__has_col = 0, 'ALTER TABLE bosslog_daily ADD COLUMN duration BIGINT NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE __alter_stmt FROM @__alter_sql;
EXECUTE __alter_stmt;
DEALLOCATE PREPARE __alter_stmt;
SET @__has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bosslog_daily' AND COLUMN_NAME = 'party_uuid');
SET @__alter_sql := IF(@__has_col = 0, 'ALTER TABLE bosslog_daily ADD COLUMN party_uuid CHAR(36) DEFAULT NULL', 'SELECT 1');
PREPARE __alter_stmt FROM @__alter_sql;
EXECUTE __alter_stmt;
DEALLOCATE PREPARE __alter_stmt;
SET @__has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bosslog_weekly' AND COLUMN_NAME = 'complete');
SET @__alter_sql := IF(@__has_col = 0, 'ALTER TABLE bosslog_weekly ADD COLUMN complete TINYINT NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE __alter_stmt FROM @__alter_sql;
EXECUTE __alter_stmt;
DEALLOCATE PREPARE __alter_stmt;
SET @__has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bosslog_weekly' AND COLUMN_NAME = 'damage');
SET @__alter_sql := IF(@__has_col = 0, 'ALTER TABLE bosslog_weekly ADD COLUMN damage BIGINT NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE __alter_stmt FROM @__alter_sql;
EXECUTE __alter_stmt;
DEALLOCATE PREPARE __alter_stmt;
SET @__has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bosslog_weekly' AND COLUMN_NAME = 'duration');
SET @__alter_sql := IF(@__has_col = 0, 'ALTER TABLE bosslog_weekly ADD COLUMN duration BIGINT NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE __alter_stmt FROM @__alter_sql;
EXECUTE __alter_stmt;
DEALLOCATE PREPARE __alter_stmt;
SET @__has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bosslog_weekly' AND COLUMN_NAME = 'party_uuid');
SET @__alter_sql := IF(@__has_col = 0, 'ALTER TABLE bosslog_weekly ADD COLUMN party_uuid CHAR(36) DEFAULT NULL', 'SELECT 1');
PREPARE __alter_stmt FROM @__alter_sql;
EXECUTE __alter_stmt;
DEALLOCATE PREPARE __alter_stmt;
CREATE TABLE IF NOT EXISTS bosslog_leaderboard_daily (
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
CREATE TABLE IF NOT EXISTS bosslog_leaderboard_weekly LIKE bosslog_leaderboard_daily;
