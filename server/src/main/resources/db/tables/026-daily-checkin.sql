-- =====================================================================
-- Daily Check-In: per-character streak state on `characters`.
--   checkinDay        INT     - last day claimed this 28-day cycle (0..28)
--   checkinClaimed    INT     - 28-bit mask of days claimed this cycle
--   checkinLastClaim  BIGINT  - epoch millis of the last claim (0 = never)
-- Idempotent: each ADD COLUMN runs only when the column is missing, so
-- =====================================================================



-- Guarded idempotent ALTERs: each runs only when the column is missing.
-- (Rewritten: Liquibase sqlFile sends the file as ONE statement, so the
-- stored-procedure + $$ delimiter form never executed. Plain SELECT-guarded
-- ALTERs execute directly and re-run as no-ops.)
SET @__has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'characters' AND COLUMN_NAME = 'checkinDay');
SET @__alter_sql := IF(@__has_col = 0, 'ALTER TABLE `characters` ADD COLUMN `checkinDay` int NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE __alter_stmt FROM @__alter_sql;
EXECUTE __alter_stmt;
DEALLOCATE PREPARE __alter_stmt;
SET @__has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'characters' AND COLUMN_NAME = 'checkinClaimed');
SET @__alter_sql := IF(@__has_col = 0, 'ALTER TABLE `characters` ADD COLUMN `checkinClaimed` int NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE __alter_stmt FROM @__alter_sql;
EXECUTE __alter_stmt;
DEALLOCATE PREPARE __alter_stmt;
SET @__has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'characters' AND COLUMN_NAME = 'checkinLastClaim');
SET @__alter_sql := IF(@__has_col = 0, 'ALTER TABLE `characters` ADD COLUMN `checkinLastClaim` bigint NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE __alter_stmt FROM @__alter_sql;
EXECUTE __alter_stmt;
DEALLOCATE PREPARE __alter_stmt;
