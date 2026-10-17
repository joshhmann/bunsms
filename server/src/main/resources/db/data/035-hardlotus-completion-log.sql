-- Hard Lotus remains unlimited; this enables existing personal/shared completion records.
-- Append to each actual ENUM instead of restating or shortening its existing/custom values.
-- Preserve nullability, default, character set/collation and authored column comments.
SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, CHARACTER_SET_NAME, COLLATION_NAME, COLUMN_COMMENT
INTO @lotus_type, @lotus_nullable, @lotus_default, @lotus_charset, @lotus_collation, @lotus_comment
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bosslog_daily' AND COLUMN_NAME = 'bosstype';
SET @lotus_ddl = IF(LOCATE(QUOTE('HARDLOTUS'), @lotus_type) > 0, 'DO 0', CONCAT(
    'ALTER TABLE `bosslog_daily` MODIFY COLUMN `bosstype` ',
    LEFT(@lotus_type, CHAR_LENGTH(@lotus_type) - 1), ',''HARDLOTUS'')',
    ' CHARACTER SET ', @lotus_charset, ' COLLATE ', @lotus_collation,
    IF(@lotus_nullable = 'YES', ' NULL', ' NOT NULL'),
    IF(@lotus_default IS NULL, '', CONCAT(' DEFAULT ', QUOTE(@lotus_default))),
    ' COMMENT ', QUOTE(@lotus_comment)));
PREPARE append_lotus_daily FROM @lotus_ddl;
EXECUTE append_lotus_daily;
DEALLOCATE PREPARE append_lotus_daily;

SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, CHARACTER_SET_NAME, COLLATION_NAME, COLUMN_COMMENT
INTO @lotus_type, @lotus_nullable, @lotus_default, @lotus_charset, @lotus_collation, @lotus_comment
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bosslog_weekly' AND COLUMN_NAME = 'bosstype';
SET @lotus_ddl = IF(LOCATE(QUOTE('HARDLOTUS'), @lotus_type) > 0, 'DO 0', CONCAT(
    'ALTER TABLE `bosslog_weekly` MODIFY COLUMN `bosstype` ',
    LEFT(@lotus_type, CHAR_LENGTH(@lotus_type) - 1), ',''HARDLOTUS'')',
    ' CHARACTER SET ', @lotus_charset, ' COLLATE ', @lotus_collation,
    IF(@lotus_nullable = 'YES', ' NULL', ' NOT NULL'),
    IF(@lotus_default IS NULL, '', CONCAT(' DEFAULT ', QUOTE(@lotus_default))),
    ' COMMENT ', QUOTE(@lotus_comment)));
PREPARE append_lotus_weekly FROM @lotus_ddl;
EXECUTE append_lotus_weekly;
DEALLOCATE PREPARE append_lotus_weekly;
