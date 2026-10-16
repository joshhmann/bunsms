-- Exact credited sale amounts cannot be recovered for historical rows.
-- NULL is intentionally unavailable for redemption, never today's price.
SET @__has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transactions' AND COLUMN_NAME = 'credited_mesos');
SET @__alter_sql := IF(@__has_col = 0, 'ALTER TABLE `transactions` ADD COLUMN `credited_mesos` int DEFAULT NULL', 'SELECT 1');
PREPARE __alter_stmt FROM @__alter_sql;
EXECUTE __alter_stmt;
DEALLOCATE PREPARE __alter_stmt;

SET @__has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transaction_items' AND COLUMN_NAME = 'sn');
SET @__alter_sql := IF(@__has_col = 0, 'ALTER TABLE `transaction_items` ADD COLUMN `sn` int NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE __alter_stmt FROM @__alter_sql;
EXECUTE __alter_stmt;
DEALLOCATE PREPARE __alter_stmt;
SET @__has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transaction_items' AND COLUMN_NAME = 'efftinthue');
SET @__alter_sql := IF(@__has_col = 0, 'ALTER TABLE `transaction_items` ADD COLUMN `efftinthue` smallint NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE __alter_stmt FROM @__alter_sql;
EXECUTE __alter_stmt;
DEALLOCATE PREPARE __alter_stmt;
SET @__has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transaction_items' AND COLUMN_NAME = 'efftintchroma');
SET @__alter_sql := IF(@__has_col = 0, 'ALTER TABLE `transaction_items` ADD COLUMN `efftintchroma` tinyint NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE __alter_stmt FROM @__alter_sql;
EXECUTE __alter_stmt;
DEALLOCATE PREPARE __alter_stmt;
SET @__has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transaction_items' AND COLUMN_NAME = 'efftintbright');
SET @__alter_sql := IF(@__has_col = 0, 'ALTER TABLE `transaction_items` ADD COLUMN `efftintbright` tinyint NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE __alter_stmt FROM @__alter_sql;
EXECUTE __alter_stmt;
DEALLOCATE PREPARE __alter_stmt;
