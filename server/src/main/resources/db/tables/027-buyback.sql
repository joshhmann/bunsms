-- =====================================================================
-- Buyback ledger: records of NPC-sold items players can buy back.
--   transactions        one row per sell event (batch of items sold together)
--   transaction_items   per-item snapshot (non-equip fields)
--   transaction_equips  equip-stat snapshot (1:1 with equip rows above)
-- Idempotent: each CREATE TABLE runs only when the table is missing, so
-- re-running is a no-op. FKs use ON DELETE CASCADE so stale servers
-- never block character/user cleanup. Applied as changeset 27 with plain
-- splitStatements (no stored procedures in this file).
-- =====================================================================

CREATE TABLE IF NOT EXISTS `transactions` (
    `transaction_id` INT NOT NULL AUTO_INCREMENT,
    `user_id` INT NOT NULL,
    `transaction_date` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `buyback_used` TINYINT(1) NOT NULL DEFAULT 0,
    PRIMARY KEY (`transaction_id`),
    KEY `user_transaction_idx` (`user_id`, `transaction_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `transaction_items` (
    `transaction_item_id` INT NOT NULL AUTO_INCREMENT,
    `transaction_id` INT NOT NULL,
    `type` TINYINT UNSIGNED NOT NULL,
    `itemid` INT NOT NULL,
    `inventorytype` INT NOT NULL,
    `position` INT NOT NULL,
    `quantity` INT NOT NULL,
    `owner` TINYTEXT NOT NULL,
    `petid` INT NOT NULL DEFAULT -1,
    `flag` INT NOT NULL,
    `expiration` BIGINT NOT NULL DEFAULT -1,
    `giftFrom` VARCHAR(26) NOT NULL DEFAULT '',
    PRIMARY KEY (`transaction_item_id`),
    KEY `transaction_id` (`transaction_id`),
    CONSTRAINT `fk_transaction_items_transaction`
        FOREIGN KEY (`transaction_id`) REFERENCES `transactions` (`transaction_id`)
        ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `transaction_equips` (
    `transaction_equip_id` INT NOT NULL AUTO_INCREMENT,
    `transaction_item_id` INT NOT NULL,
    `upgradeslots` INT NOT NULL DEFAULT 0,
    `level` INT NOT NULL DEFAULT 0,
    `str` INT NOT NULL DEFAULT 0,
    `dex` INT NOT NULL DEFAULT 0,
    `int` INT NOT NULL DEFAULT 0,
    `luk` INT NOT NULL DEFAULT 0,
    `hp` INT NOT NULL DEFAULT 0,
    `mp` INT NOT NULL DEFAULT 0,
    `watk` INT NOT NULL DEFAULT 0,
    `matk` INT NOT NULL DEFAULT 0,
    `wdef` INT NOT NULL DEFAULT 0,
    `mdef` INT NOT NULL DEFAULT 0,
    `acc` INT NOT NULL DEFAULT 0,
    `avoid` INT NOT NULL DEFAULT 0,
    `hands` INT NOT NULL DEFAULT 0,
    `speed` INT NOT NULL DEFAULT 0,
    `jump` INT NOT NULL DEFAULT 0,
    `vicious` INT UNSIGNED NOT NULL DEFAULT 0,
    `itemlevel` INT NOT NULL DEFAULT 1,
    `itemexp` INT UNSIGNED NOT NULL DEFAULT 0,
    `ringid` INT NOT NULL DEFAULT -1,
    PRIMARY KEY (`transaction_equip_id`),
    KEY `transaction_item_id` (`transaction_item_id`),
    CONSTRAINT `fk_transaction_equips_item`
        FOREIGN KEY (`transaction_item_id`) REFERENCES `transaction_items` (`transaction_item_id`)
        ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
