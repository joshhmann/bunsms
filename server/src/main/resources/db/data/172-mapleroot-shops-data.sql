-- MapleRoot wave 1: shopupdate port (ticket #5), part 1 of 2.
-- Source: 3-db_shopupdate.sql from "MapleRoot Full Repack.zip"
-- (Server/database/sql/, md5 a496dd77b071dd6a2bdbcadf52de2259).
-- Accounting (machine-reconciled, 0 conflicts): 112 rows here (3 named shops
-- from the source header comment: scroll shop at Asia 2082014, chair shop at
-- Kino Konoko 9110002, potion shop at T-1337 9201101) + 169 rows already
-- value-exact in the 102 baseline (never re-inserted — shopitems PK is
-- shopitemid, so re-inserts would duplicate) + 37 genuinely missing rows in
-- 173-mapleroot-shops-remainder-data.sql = 318 source rows. The source
-- DELETE WHERE shopid=1337 is deliberately NOT ported (would wipe the live
-- GM shop served by GmShopCommand). Casino shop 9999001 untouched.
-- Pair-guarded shopitems inserts preserve every existing price/position row.
-- 2082014 positions 33-79 prices are pre-multiplied 11x, matching the
-- source file's UPDATE (e.g. position 33: 50000 -> 550000).

-- shops rows (INSERT IGNORE: never overwrite existing buns rows)
INSERT IGNORE INTO shops (shopid, npcid)
VALUES (2082014, 2082014),
       (9110002, 9110002),
       (9201101, 9201101);

-- 2082014 scroll shop: 91 rows (positions 33-79 pre-multiplied 11x per source UPDATE)
INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040004, 480000, 0, 1 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040004);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040025, 500000, 0, 2 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040025);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040029, 500000, 0, 3 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040029);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040017, 500000, 0, 4 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040017);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040301, 400000, 0, 5 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040301);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040317, 400000, 0, 6 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040317);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040321, 400000, 0, 7 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040321);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040413, 400000, 0, 8 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040413);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040418, 400000, 0, 9 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040418);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040501, 250000, 0, 10 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040501);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040513, 250000, 0, 11 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040513);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040516, 250000, 0, 12 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040516);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040532, 250000, 0, 13 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040532);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040613, 400000, 0, 14 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040613);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040701, 450000, 0, 15 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040701);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040704, 450000, 0, 16 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040704);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040707, 450000, 0, 17 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040707);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040804, 550000, 0, 18 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040804);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040817, 550000, 0, 19 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040817);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040914, 480000, 0, 20 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040914);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040919, 480000, 0, 21 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040919);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2041007, 470000, 0, 22 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2041007);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2041010, 470000, 0, 23 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2041010);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2041013, 500000, 0, 24 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2041013);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2041016, 500000, 0, 25 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2041016);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2041019, 500000, 0, 26 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2041019);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2041022, 500000, 0, 27 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2041022);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2044901, 520000, 0, 28 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2044901);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2044701, 520000, 0, 29 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2044701);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2043001, 520000, 0, 30 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2043001);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2043801, 520000, 0, 31 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2043801);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2044601, 520000, 0, 32 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2044601);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040727, 550000, 0, 33 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040727);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2041058, 550000, 0, 34 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2041058);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040807, 11000000, 0, 35 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040807);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040005, 242000, 0, 36 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040005);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040026, 253000, 0, 37 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040026);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040031, 253000, 0, 38 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040031);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040016, 253000, 0, 39 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040016);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040302, 275000, 0, 40 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040302);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040318, 275000, 0, 41 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040318);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040323, 275000, 0, 42 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040323);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040412, 220000, 0, 43 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040412);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040419, 220000, 0, 44 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040419);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040502, 275000, 0, 45 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040502);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040514, 275000, 0, 46 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040514);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040517, 275000, 0, 47 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040517);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040534, 275000, 0, 48 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040534);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040612, 220000, 0, 49 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040612);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040702, 220000, 0, 50 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040702);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040705, 275000, 0, 51 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040705);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040708, 220000, 0, 52 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040708);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040805, 1100000, 0, 53 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040805);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040816, 1100000, 0, 54 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040816);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040915, 605000, 0, 55 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040915);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040920, 605000, 0, 56 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040920);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2041008, 418000, 0, 57 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2041008);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2041011, 418000, 0, 58 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2041011);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2041014, 440000, 0, 59 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2041014);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2041017, 440000, 0, 60 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2041017);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2041020, 440000, 0, 61 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2041020);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2041023, 440000, 0, 62 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2041023);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2044902, 550000, 0, 63 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2044902);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2044702, 550000, 0, 64 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2044702);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2043002, 550000, 0, 65 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2043002);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2043802, 550000, 0, 66 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2043802);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2044602, 550000, 0, 67 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2044602);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2049200, 1870000, 0, 68 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2049200);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2049201, 2420000, 0, 69 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2049201);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2049202, 1870000, 0, 70 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2049202);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2049203, 2420000, 0, 71 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2049203);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2049204, 1870000, 0, 72 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2049204);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2049205, 2420000, 0, 73 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2049205);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2049206, 1870000, 0, 74 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2049206);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2049207, 2420000, 0, 75 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2049207);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2049208, 1540000, 0, 76 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2049208);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2049209, 1870000, 0, 77 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2049209);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2049210, 1540000, 0, 78 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2049210);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2049211, 1870000, 0, 79 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2049211);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040101, 540000, 0, 80 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040101);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040100, 700000, 0, 81 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040100);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040106, 540000, 0, 82 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040106);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040105, 700000, 0, 83 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040105);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040201, 540000, 0, 84 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040201);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040200, 700000, 0, 85 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040200);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040206, 540000, 0, 86 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040206);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2040205, 700000, 0, 87 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2040205);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2070016, 120000000, 0, 88 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2070016);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2070018, 190000000, 0, 89 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2070018);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 2030007, 1800000, 0, 90 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 2030007);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 2082014, 4001017, 60000000, 0, 91 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 2082014 AND itemid = 4001017);

-- 9110002 chair shop (3 rows) + 9201101 potion shop (18 rows)
INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 9110002, 3010019, 7700000, 0, 92 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 9110002 AND itemid = 3010019);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 9110002, 3010008, 10000000, 0, 96 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 9110002 AND itemid = 3010008);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 9110002, 3010007, 10000000, 0, 100 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 9110002 AND itemid = 3010007);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 9201101, 2022338, 2100000, 0, 100 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 9201101 AND itemid = 2022338);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 9201101, 2022339, 2800000, 0, 104 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 9201101 AND itemid = 2022339);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 9201101, 2022340, 4000000, 0, 108 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 9201101 AND itemid = 2022340);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 9201101, 2022341, 2800000, 0, 112 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 9201101 AND itemid = 2022341);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 9201101, 2022342, 2000000, 0, 116 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 9201101 AND itemid = 2022342);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 9201101, 2022343, 4700000, 0, 120 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 9201101 AND itemid = 2022343);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 9201101, 2022344, 5000000, 0, 124 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 9201101 AND itemid = 2022344);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 9201101, 2022345, 4000000, 0, 128 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 9201101 AND itemid = 2022345);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 9201101, 2002028, 5000000, 0, 132 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 9201101 AND itemid = 2002028);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 9201101, 2022544, 100000, 0, 136 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 9201101 AND itemid = 2022544);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 9201101, 2022545, 4400000, 0, 140 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 9201101 AND itemid = 2022545);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 9201101, 2020027, 2100000, 0, 144 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 9201101 AND itemid = 2020027);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 9201101, 2022113, 1800000, 0, 148 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 9201101 AND itemid = 2022113);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 9201101, 2022121, 12000000, 0, 152 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 9201101 AND itemid = 2022121);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 9201101, 2022123, 12000000, 0, 156 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 9201101 AND itemid = 2022123);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 9201101, 2022277, 5300000, 0, 160 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 9201101 AND itemid = 2022277);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 9201101, 2012008, 4200000, 0, 164 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 9201101 AND itemid = 2012008);

INSERT INTO shopitems (shopid, itemid, price, pitch, position)
SELECT 9201101, 2022251, 3800000, 0, 168 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM shopitems WHERE shopid = 9201101 AND itemid = 2022251);
