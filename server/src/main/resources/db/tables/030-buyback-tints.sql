-- =====================================================================
-- Buyback tints: persist coloring-prism dye through the sell/buyback ledger.
--   transaction_equips  6 cols: tinthue/tintchroma/tintbright (body),
--                       tintfxhue/tintfxchroma/tintfxbright (effect art)
-- Types mirror inventoryequipment in 028-coloring-prism.sql (smallint body/FX
-- hue, tinyint chroma/bright) so a ledger row round-trips into a fresh Equip
-- with identical tints; all-zero stays the never-dyed identity. Relog
-- preservation holds by construction (DB-backed row -> fresh Equip).
-- Idempotent: each ADD COLUMN runs only when the column is missing, so
-- =====================================================================


-- Guarded idempotent ALTERs: each runs only when the column is missing.
-- (Rewritten: Liquibase sqlFile sends the file as ONE statement, so the
-- stored-procedure + $$ delimiter form never executed. Plain SELECT-guarded
-- ALTERs execute directly and re-run as no-ops.)
SET @__has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transaction_equips' AND COLUMN_NAME = 'tinthue');
SET @__alter_sql := IF(@__has_col = 0, 'ALTER TABLE `transaction_equips` ADD COLUMN `tinthue` smallint NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE __alter_stmt FROM @__alter_sql;
EXECUTE __alter_stmt;
DEALLOCATE PREPARE __alter_stmt;
SET @__has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transaction_equips' AND COLUMN_NAME = 'tintchroma');
SET @__alter_sql := IF(@__has_col = 0, 'ALTER TABLE `transaction_equips` ADD COLUMN `tintchroma` tinyint NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE __alter_stmt FROM @__alter_sql;
EXECUTE __alter_stmt;
DEALLOCATE PREPARE __alter_stmt;
SET @__has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transaction_equips' AND COLUMN_NAME = 'tintbright');
SET @__alter_sql := IF(@__has_col = 0, 'ALTER TABLE `transaction_equips` ADD COLUMN `tintbright` tinyint NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE __alter_stmt FROM @__alter_sql;
EXECUTE __alter_stmt;
DEALLOCATE PREPARE __alter_stmt;
SET @__has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transaction_equips' AND COLUMN_NAME = 'tintfxhue');
SET @__alter_sql := IF(@__has_col = 0, 'ALTER TABLE `transaction_equips` ADD COLUMN `tintfxhue` smallint NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE __alter_stmt FROM @__alter_sql;
EXECUTE __alter_stmt;
DEALLOCATE PREPARE __alter_stmt;
SET @__has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transaction_equips' AND COLUMN_NAME = 'tintfxchroma');
SET @__alter_sql := IF(@__has_col = 0, 'ALTER TABLE `transaction_equips` ADD COLUMN `tintfxchroma` tinyint NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE __alter_stmt FROM @__alter_sql;
EXECUTE __alter_stmt;
DEALLOCATE PREPARE __alter_stmt;
SET @__has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transaction_equips' AND COLUMN_NAME = 'tintfxbright');
SET @__alter_sql := IF(@__has_col = 0, 'ALTER TABLE `transaction_equips` ADD COLUMN `tintfxbright` tinyint NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE __alter_stmt FROM @__alter_sql;
EXECUTE __alter_stmt;
DEALLOCATE PREPARE __alter_stmt;
