-- =====================================================================
-- Daily Check-In: per-character streak state on `characters`.
--   checkinDay        INT     - last day claimed this 28-day cycle (0..28)
--   checkinClaimed    INT     - 28-bit mask of days claimed this cycle
--   checkinLastClaim  BIGINT  - epoch millis of the last claim (0 = never)
-- Idempotent: each ADD COLUMN runs only when the column is missing, so
-- re-running is a no-op. Applied with splitStatements=false + endDelimiter=$$
-- (see changeset 26) because the guarded ALTERs need a stored procedure.
-- =====================================================================

DROP PROCEDURE IF EXISTS _add_checkin_columns $$

CREATE PROCEDURE _add_checkin_columns()
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'characters'
                     AND COLUMN_NAME = 'checkinDay') THEN
        ALTER TABLE `characters` ADD COLUMN `checkinDay` int NOT NULL DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'characters'
                     AND COLUMN_NAME = 'checkinClaimed') THEN
        ALTER TABLE `characters` ADD COLUMN `checkinClaimed` int NOT NULL DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'characters'
                     AND COLUMN_NAME = 'checkinLastClaim') THEN
        ALTER TABLE `characters` ADD COLUMN `checkinLastClaim` bigint NOT NULL DEFAULT 0;
    END IF;
END $$

CALL _add_checkin_columns() $$

DROP PROCEDURE IF EXISTS _add_checkin_columns $$
