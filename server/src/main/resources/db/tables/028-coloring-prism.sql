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
-- re-running is a no-op. Applied with splitStatements=false + endDelimiter=$$
-- (see changeset 28) because the guarded ALTERs need a stored procedure.
-- Shop 1337 is NOT touched: no test-shop seeding lives here.
-- =====================================================================

DROP PROCEDURE IF EXISTS _add_prism_columns $$

CREATE PROCEDURE _add_prism_columns()
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventoryequipment'
                     AND COLUMN_NAME = 'tinthue') THEN
        ALTER TABLE `inventoryequipment` ADD COLUMN `tinthue` smallint NOT NULL DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventoryequipment'
                     AND COLUMN_NAME = 'tintchroma') THEN
        ALTER TABLE `inventoryequipment` ADD COLUMN `tintchroma` tinyint NOT NULL DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventoryequipment'
                     AND COLUMN_NAME = 'tintbright') THEN
        ALTER TABLE `inventoryequipment` ADD COLUMN `tintbright` tinyint NOT NULL DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventoryequipment'
                     AND COLUMN_NAME = 'tintfxhue') THEN
        ALTER TABLE `inventoryequipment` ADD COLUMN `tintfxhue` smallint NOT NULL DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventoryequipment'
                     AND COLUMN_NAME = 'tintfxchroma') THEN
        ALTER TABLE `inventoryequipment` ADD COLUMN `tintfxchroma` tinyint NOT NULL DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventoryequipment'
                     AND COLUMN_NAME = 'tintfxbright') THEN
        ALTER TABLE `inventoryequipment` ADD COLUMN `tintfxbright` tinyint NOT NULL DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'characters'
                     AND COLUMN_NAME = 'hairtinthue') THEN
        ALTER TABLE `characters` ADD COLUMN `hairtinthue` smallint NOT NULL DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'characters'
                     AND COLUMN_NAME = 'hairtintchroma') THEN
        ALTER TABLE `characters` ADD COLUMN `hairtintchroma` tinyint NOT NULL DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'characters'
                     AND COLUMN_NAME = 'hairtintbright') THEN
        ALTER TABLE `characters` ADD COLUMN `hairtintbright` tinyint NOT NULL DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'characters'
                     AND COLUMN_NAME = 'facetinthue') THEN
        ALTER TABLE `characters` ADD COLUMN `facetinthue` smallint NOT NULL DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'characters'
                     AND COLUMN_NAME = 'facetintchroma') THEN
        ALTER TABLE `characters` ADD COLUMN `facetintchroma` tinyint NOT NULL DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'characters'
                     AND COLUMN_NAME = 'facetintbright') THEN
        ALTER TABLE `characters` ADD COLUMN `facetintbright` tinyint NOT NULL DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'characters'
                     AND COLUMN_NAME = 'skintinthue') THEN
        ALTER TABLE `characters` ADD COLUMN `skintinthue` smallint NOT NULL DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'characters'
                     AND COLUMN_NAME = 'skintintchroma') THEN
        ALTER TABLE `characters` ADD COLUMN `skintintchroma` tinyint NOT NULL DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'characters'
                     AND COLUMN_NAME = 'skintintbright') THEN
        ALTER TABLE `characters` ADD COLUMN `skintintbright` tinyint NOT NULL DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventoryitems'
                     AND COLUMN_NAME = 'efftinthue') THEN
        ALTER TABLE `inventoryitems` ADD COLUMN `efftinthue` smallint NOT NULL DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventoryitems'
                     AND COLUMN_NAME = 'efftintchroma') THEN
        ALTER TABLE `inventoryitems` ADD COLUMN `efftintchroma` tinyint NOT NULL DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventoryitems'
                     AND COLUMN_NAME = 'efftintbright') THEN
        ALTER TABLE `inventoryitems` ADD COLUMN `efftintbright` tinyint NOT NULL DEFAULT 0;
    END IF;
END $$

CALL _add_prism_columns() $$

DROP PROCEDURE IF EXISTS _add_prism_columns $$

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 $$
