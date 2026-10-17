-- A cleared party owns its participant names, including genuine headless bots.
-- Legacy rows retain all history; only names still known from characters can be
-- backfilled. These are current known names, not a claim about pre-rename names.
-- Deleted legacy participants remain NULL and are displayed explicitly as unknown.
SET @__has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bosslog_leaderboard_daily' AND COLUMN_NAME = 'character_name');
SET @__alter_sql := IF(@__has_col = 0, 'ALTER TABLE bosslog_leaderboard_daily ADD COLUMN character_name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL', 'SELECT 1');
PREPARE __alter_stmt FROM @__alter_sql;
EXECUTE __alter_stmt;
DEALLOCATE PREPARE __alter_stmt;
SET @__has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bosslog_leaderboard_weekly' AND COLUMN_NAME = 'character_name');
SET @__alter_sql := IF(@__has_col = 0, 'ALTER TABLE bosslog_leaderboard_weekly ADD COLUMN character_name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL', 'SELECT 1');
PREPARE __alter_stmt FROM @__alter_sql;
EXECUTE __alter_stmt;
DEALLOCATE PREPARE __alter_stmt;
UPDATE bosslog_leaderboard_daily bl JOIN characters c ON c.id = bl.characterid SET bl.character_name = c.name WHERE bl.character_name IS NULL;
UPDATE bosslog_leaderboard_weekly bl JOIN characters c ON c.id = bl.characterid SET bl.character_name = c.name WHERE bl.character_name IS NULL;
