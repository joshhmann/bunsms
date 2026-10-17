-- Ticket #5 reconciliation remainder: the 37 source rows present in NEITHER
-- the Buns baseline (102-shopitems-data.sql) NOR migration 172.
-- Accounting: 112 (landed 172, value-exact) + 169 (already value-exact in the
-- 102 baseline, never re-inserted — shopitems PK is shopitemid, so plain
-- re-inserts would duplicate) + 37 (this file) = 318 source rows, 0 conflicts.
-- The source DELETE WHERE shopid=1337 is deliberately NOT ported (would wipe
-- the live GM shop served by GmShopCommand).
--
-- Idempotence: per-row INSERT ... SELECT ... WHERE NOT EXISTS on
-- (shopid, itemid), so re-runs are provable no-ops — every existing row's
-- price/position is preserved exactly and only genuinely absent pairs are
-- added. (INSERT IGNORE would NOT dedupe here: no unique key on
-- (shopid, itemid) exists, and adding one is out of scope.) Liquibase runs
-- each changeset under its migration lock, so concurrent appliers cannot
-- interleave these single-statement inserts.
-- All 34 target shops already exist in 101-shops-data.sql: shopitems only.
-- Prices/positions verbatim from source (the source 11x UPDATE touched only
-- shop 2082014, fully covered by 172).

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 1338, 2030100, 450, 0, 114 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 1338 AND itemid = 2030100);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 1001100, 2030100, 450, 0, 130 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 1001100 AND itemid = 2030100);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 1011100, 2030100, 450, 0, 142 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 1011100 AND itemid = 2030100);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 1021100, 2030100, 450, 0, 142 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 1021100 AND itemid = 2030100);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 1031100, 3010015, 20000, 0, 100 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 1031100 AND itemid = 3010015);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 1031100, 2030100, 450, 0, 146 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 1031100 AND itemid = 2030100);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 1051002, 2030100, 450, 0, 142 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 1051002 AND itemid = 2030100);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 1052116, 2030100, 450, 0, 118 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 1052116 AND itemid = 2030100);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 1061001, 2030100, 450, 0, 126 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 1061001 AND itemid = 2030100);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 1061002, 2030100, 450, 0, 130 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 1061002 AND itemid = 2030100);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 1081000, 3010013, 4000000, 0, 100 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 1081000 AND itemid = 3010013);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 1091002, 2030100, 450, 0, 130 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 1091002 AND itemid = 2030100);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 1100002, 2030100, 450, 0, 138 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 1100002 AND itemid = 2030100);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 1200002, 2030100, 400, 0, 128 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 1200002 AND itemid = 2030100);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 1301000, 2030100, 400, 0, 120 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 1301000 AND itemid = 2030100);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 1301000, 2000015, 160, 0, 168 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 1301000 AND itemid = 2000015);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2012005, 2030100, 450, 0, 126 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2012005 AND itemid = 2030100);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2022001, 2030100, 450, 0, 126 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2022001 AND itemid = 2030100);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2030009, 2030100, 450, 0, 126 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2030009 AND itemid = 2030100);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2040051, 2030100, 450, 0, 102 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2040051 AND itemid = 2030100);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2041006, 2030100, 450, 0, 134 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2041006 AND itemid = 2030100);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2051000, 2030100, 450, 0, 134 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2051000 AND itemid = 2030100);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2060004, 2030100, 450, 0, 134 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2060004 AND itemid = 2030100);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2070001, 2030100, 450, 0, 134 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2070001 AND itemid = 2030100);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2080001, 2030100, 450, 0, 134 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2080001 AND itemid = 2030100);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2090003, 2030100, 450, 0, 126 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2090003 AND itemid = 2030100);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2093002, 2030100, 450, 0, 126 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2093002 AND itemid = 2030100);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2100004, 2030100, 450, 0, 130 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2100004 AND itemid = 2030100);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2110001, 2030100, 450, 0, 130 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2110001 AND itemid = 2030100);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2130000, 2030100, 450, 0, 126 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2130000 AND itemid = 2030100);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 9201020, 3010009, 4200000, 0, 96 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 9201020 AND itemid = 3010009);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 9201020, 3010014, 7000000, 0, 100 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 9201020 AND itemid = 3010014);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 9201060, 2030100, 450, 0, 114 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 9201060 AND itemid = 2030100);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 9270021, 2030100, 450, 0, 118 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 9270021 AND itemid = 2030100);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 9270022, 2030100, 450, 0, 114 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 9270022 AND itemid = 2030100);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 9270057, 2030100, 450, 0, 4 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 9270057 AND itemid = 2030100);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 9270065, 2030100, 450, 0, 3 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 9270065 AND itemid = 2030100);
