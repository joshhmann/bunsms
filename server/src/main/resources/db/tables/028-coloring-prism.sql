-- =====================================================================
-- Coloring prism (ticket #11): weapon/look/skill tint persistence.
--   inventoryequipment  6 cols: tinthue/tintchroma/tintbright (body),
--                       tintfxhue/tintfxchroma/tintfxbright (effect art)
--   characters          9 cols: hair*/face*/skin* tint triples
--   inventoryitems      3 cols: efftinthue/efftintchroma/efftintbright
--                       (named efftint* on purpose: ItemFactory joins the two
--                       inventory tables with SELECT *, and twin `tint*` names
--                       would throw Duplicate column name on the login path)
--   skilltints          per-skill dye table keyed (characterid, skillid);
--                       no row means vanilla; cascades on character delete
-- Idempotent: every ADD COLUMN / CREATE TABLE runs only when missing, so

-- Guarded idempotent ALTERs: each runs only when the column is missing.
-- (Rewritten: Liquibase sqlFile sends the file as ONE statement, so the
-- stored-procedure + $$ delimiter form never executed. Plain SELECT-guarded
-- ALTERs execute directly and re-run as no-ops.)
SET @__has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventoryequipment' AND COLUMN_NAME = 'tinthue');
SET @__alter_sql := IF(@__has_col = 0, 'ALTER TABLE `inventoryequipment` ADD COLUMN `tinthue` smallint NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE __alter_stmt FROM @__alter_sql;
EXECUTE __alter_stmt;
DEALLOCATE PREPARE __alter_stmt;
SET @__has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventoryequipment' AND COLUMN_NAME = 'tintchroma');
SET @__alter_sql := IF(@__has_col = 0, 'ALTER TABLE `inventoryequipment` ADD COLUMN `tintchroma` tinyint NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE __alter_stmt FROM @__alter_sql;
EXECUTE __alter_stmt;
DEALLOCATE PREPARE __alter_stmt;
SET @__has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventoryequipment' AND COLUMN_NAME = 'tintbright');
SET @__alter_sql := IF(@__has_col = 0, 'ALTER TABLE `inventoryequipment` ADD COLUMN `tintbright` tinyint NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE __alter_stmt FROM @__alter_sql;
EXECUTE __alter_stmt;
DEALLOCATE PREPARE __alter_stmt;
SET @__has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventoryequipment' AND COLUMN_NAME = 'tintfxhue');
SET @__alter_sql := IF(@__has_col = 0, 'ALTER TABLE `inventoryequipment` ADD COLUMN `tintfxhue` smallint NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE __alter_stmt FROM @__alter_sql;
EXECUTE __alter_stmt;
DEALLOCATE PREPARE __alter_stmt;
SET @__has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventoryequipment' AND COLUMN_NAME = 'tintfxchroma');
SET @__alter_sql := IF(@__has_col = 0, 'ALTER TABLE `inventoryequipment` ADD COLUMN `tintfxchroma` tinyint NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE __alter_stmt FROM @__alter_sql;
EXECUTE __alter_stmt;
DEALLOCATE PREPARE __alter_stmt;
SET @__has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventoryequipment' AND COLUMN_NAME = 'tintfxbright');
SET @__alter_sql := IF(@__has_col = 0, 'ALTER TABLE `inventoryequipment` ADD COLUMN `tintfxbright` tinyint NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE __alter_stmt FROM @__alter_sql;
EXECUTE __alter_stmt;
DEALLOCATE PREPARE __alter_stmt;
SET @__has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'characters' AND COLUMN_NAME = 'hairtinthue');
SET @__alter_sql := IF(@__has_col = 0, 'ALTER TABLE `characters` ADD COLUMN `hairtinthue` smallint NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE __alter_stmt FROM @__alter_sql;
EXECUTE __alter_stmt;
DEALLOCATE PREPARE __alter_stmt;
SET @__has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'characters' AND COLUMN_NAME = 'hairtintchroma');
SET @__alter_sql := IF(@__has_col = 0, 'ALTER TABLE `characters` ADD COLUMN `hairtintchroma` tinyint NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE __alter_stmt FROM @__alter_sql;
EXECUTE __alter_stmt;
DEALLOCATE PREPARE __alter_stmt;
SET @__has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'characters' AND COLUMN_NAME = 'hairtintbright');
SET @__alter_sql := IF(@__has_col = 0, 'ALTER TABLE `characters` ADD COLUMN `hairtintbright` tinyint NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE __alter_stmt FROM @__alter_sql;
EXECUTE __alter_stmt;
DEALLOCATE PREPARE __alter_stmt;
SET @__has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'characters' AND COLUMN_NAME = 'facetinthue');
SET @__alter_sql := IF(@__has_col = 0, 'ALTER TABLE `characters` ADD COLUMN `facetinthue` smallint NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE __alter_stmt FROM @__alter_sql;
EXECUTE __alter_stmt;
DEALLOCATE PREPARE __alter_stmt;
SET @__has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'characters' AND COLUMN_NAME = 'facetintchroma');
SET @__alter_sql := IF(@__has_col = 0, 'ALTER TABLE `characters` ADD COLUMN `facetintchroma` tinyint NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE __alter_stmt FROM @__alter_sql;
EXECUTE __alter_stmt;
DEALLOCATE PREPARE __alter_stmt;
SET @__has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'characters' AND COLUMN_NAME = 'facetintbright');
SET @__alter_sql := IF(@__has_col = 0, 'ALTER TABLE `characters` ADD COLUMN `facetintbright` tinyint NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE __alter_stmt FROM @__alter_sql;
EXECUTE __alter_stmt;
DEALLOCATE PREPARE __alter_stmt;
SET @__has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'characters' AND COLUMN_NAME = 'skintinthue');
SET @__alter_sql := IF(@__has_col = 0, 'ALTER TABLE `characters` ADD COLUMN `skintinthue` smallint NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE __alter_stmt FROM @__alter_sql;
EXECUTE __alter_stmt;
DEALLOCATE PREPARE __alter_stmt;
SET @__has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'characters' AND COLUMN_NAME = 'skintintchroma');
SET @__alter_sql := IF(@__has_col = 0, 'ALTER TABLE `characters` ADD COLUMN `skintintchroma` tinyint NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE __alter_stmt FROM @__alter_sql;
EXECUTE __alter_stmt;
DEALLOCATE PREPARE __alter_stmt;
SET @__has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'characters' AND COLUMN_NAME = 'skintintbright');
SET @__alter_sql := IF(@__has_col = 0, 'ALTER TABLE `characters` ADD COLUMN `skintintbright` tinyint NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE __alter_stmt FROM @__alter_sql;
EXECUTE __alter_stmt;
DEALLOCATE PREPARE __alter_stmt;
SET @__has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventoryitems' AND COLUMN_NAME = 'efftinthue');
SET @__alter_sql := IF(@__has_col = 0, 'ALTER TABLE `inventoryitems` ADD COLUMN `efftinthue` smallint NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE __alter_stmt FROM @__alter_sql;
EXECUTE __alter_stmt;
DEALLOCATE PREPARE __alter_stmt;
SET @__has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventoryitems' AND COLUMN_NAME = 'efftintchroma');
SET @__alter_sql := IF(@__has_col = 0, 'ALTER TABLE `inventoryitems` ADD COLUMN `efftintchroma` tinyint NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE __alter_stmt FROM @__alter_sql;
EXECUTE __alter_stmt;
DEALLOCATE PREPARE __alter_stmt;
SET @__has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventoryitems' AND COLUMN_NAME = 'efftintbright');
SET @__alter_sql := IF(@__has_col = 0, 'ALTER TABLE `inventoryitems` ADD COLUMN `efftintbright` tinyint NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE __alter_stmt FROM @__alter_sql;
EXECUTE __alter_stmt;
DEALLOCATE PREPARE __alter_stmt;
CREATE TABLE IF NOT EXISTS `skilltints` (
    `characterid` INT NOT NULL,
    `skillid` INT NOT NULL,
    `tinthue` SMALLINT NOT NULL DEFAULT 0,
    `tintchroma` TINYINT NOT NULL DEFAULT 0,
    `tintbright` TINYINT NOT NULL DEFAULT 0,
    PRIMARY KEY (`characterid`, `skillid`),
    CONSTRAINT `fk_skilltints_character`
        FOREIGN KEY (`characterid`) REFERENCES `characters` (`id`)
        ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
