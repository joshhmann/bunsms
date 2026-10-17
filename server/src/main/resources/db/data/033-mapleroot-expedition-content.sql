-- Ticket 9: genuine MapleRoot expedition loot and prerequisite acquisition.
-- Source: MapleRoot Full Repack/Database/CLEANDB.sql, SHA-256
-- ba55cf40994625528c326e4d247dc178411269a08f7c248422d36ad1c3811428.
-- All 61 positive-quantity enabled boss rows and 15 prerequisite rows retain
-- the exact source mob, item, quantity, quest and chance values. Thirteen
-- source zero-quantity rows are intentionally excluded; no quantity is invented.
-- Source primary keys are local to CLEANDB and are never imported.
-- Guards preserve every existing (dropperid,itemid) pair, even if customized.
-- Existing rows, global rates, global/reactor drops and stock encounters are
-- unchanged. Liquibase serializes application under its normal migration lock.
-- Deploy with the corresponding genuine item/mob/quest asset cohort.

-- Boss drops.

-- CLEANDB source row 19223.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 9420522, 1302056, 1, 1, 0, 700 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 9420522 AND itemid = 1302056);

-- CLEANDB source row 19224.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 9420522, 1312030, 1, 1, 0, 3000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 9420522 AND itemid = 1312030);

-- CLEANDB source row 19225.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 9420522, 1322045, 1, 1, 0, 3000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 9420522 AND itemid = 1322045);

-- CLEANDB source row 19226.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 9420522, 1332051, 1, 1, 0, 25000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 9420522 AND itemid = 1332051);

-- CLEANDB source row 19227.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 9420522, 1332052, 1, 1, 0, 25000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 9420522 AND itemid = 1332052);

-- CLEANDB source row 19228.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 9420522, 1372010, 1, 1, 0, 3000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 9420522 AND itemid = 1372010);

-- CLEANDB source row 19229.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 9420522, 1382035, 1, 1, 0, 3000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 9420522 AND itemid = 1382035);

-- CLEANDB source row 19230.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 9420522, 1402035, 1, 1, 0, 3000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 9420522 AND itemid = 1402035);

-- CLEANDB source row 19231.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 9420522, 1412021, 1, 1, 0, 3000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 9420522 AND itemid = 1412021);

-- CLEANDB source row 19232.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 9420522, 1422027, 1, 1, 0, 3000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 9420522 AND itemid = 1422027);

-- CLEANDB source row 19233.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 9420522, 1432030, 1, 1, 0, 25000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 9420522 AND itemid = 1432030);

-- CLEANDB source row 19234.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 9420522, 1442044, 1, 1, 0, 3000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 9420522 AND itemid = 1442044);

-- CLEANDB source row 19235.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 9420522, 1452019, 1, 1, 0, 25000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 9420522 AND itemid = 1452019);

-- CLEANDB source row 19236.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 9420522, 1452020, 1, 1, 0, 25000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 9420522 AND itemid = 1452020);

-- CLEANDB source row 19237.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 9420522, 1462015, 1, 1, 0, 25000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 9420522 AND itemid = 1462015);

-- CLEANDB source row 19238.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 9420522, 1462016, 1, 1, 0, 25000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 9420522 AND itemid = 1462016);

-- CLEANDB source row 19239.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 9420522, 1472053, 1, 1, 0, 13000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 9420522 AND itemid = 1472053);

-- CLEANDB source row 19240.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 9420522, 2020013, 1, 1, 0, 333333 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 9420522 AND itemid = 2020013);

-- CLEANDB source row 19241.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 9420522, 2020015, 1, 1, 0, 333333 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 9420522 AND itemid = 2020015);

-- CLEANDB source row 26399.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 9400409, 4000703, 1, 1, 0, 3000000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 9400409 AND itemid = 4000703);

-- CLEANDB source row 35125.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 8880302, 2000005, 1, 1, 0, 1000000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 8880302 AND itemid = 2000005);

-- CLEANDB source row 35369.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 9400408, 4000345, 1, 1, 0, 999999 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 9400408 AND itemid = 4000345);

-- CLEANDB source row 35370.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 9400408, 4000346, 1, 1, 0, 999999 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 9400408 AND itemid = 4000346);

-- CLEANDB source row 35371.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 9400408, 1382045, 1, 1, 0, 7000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 9400408 AND itemid = 1382045);

-- CLEANDB source row 35372.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 9400408, 1382046, 1, 1, 0, 7000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 9400408 AND itemid = 1382046);

-- CLEANDB source row 35373.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 9400408, 1382047, 1, 1, 0, 7000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 9400408 AND itemid = 1382047);

-- CLEANDB source row 35374.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 9400408, 1382048, 1, 1, 0, 7000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 9400408 AND itemid = 1382048);

-- CLEANDB source row 35375.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 9400408, 2000005, 1, 1, 0, 12000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 9400408 AND itemid = 2000005);

-- CLEANDB source row 35389.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 9400409, 2000005, 1, 1, 0, 12000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 9400409 AND itemid = 2000005);

-- CLEANDB source row 35910.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 9420522, 1112413, 1, 1, 0, 30000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 9420522 AND itemid = 1112413);

-- CLEANDB source row 35917.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 9400409, 1022175, 1, 1, 0, 30000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 9400409 AND itemid = 1022175);

-- CLEANDB source row 35926.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 8850012, 2388152, 1, 1, 0, 100000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 8850012 AND itemid = 2388152);

-- CLEANDB source row 35930.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 9400408, 2388159, 1, 1, 0, 100000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 9400408 AND itemid = 2388159);

-- CLEANDB source row 35942.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 8850012, 2388149, 1, 1, 0, 100000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 8850012 AND itemid = 2388149);

-- CLEANDB source row 35943.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 8850012, 2388148, 1, 1, 0, 100000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 8850012 AND itemid = 2388148);

-- CLEANDB source row 35944.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 8850012, 2388147, 1, 1, 0, 100000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 8850012 AND itemid = 2388147);

-- CLEANDB source row 35945.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 8850012, 2388150, 1, 1, 0, 100000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 8850012 AND itemid = 2388150);

-- CLEANDB source row 35946.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 8850012, 2388151, 1, 1, 0, 100000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 8850012 AND itemid = 2388151);

-- CLEANDB source row 35972.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 8847777, 2388146, 1, 1, 0, 100000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 8847777 AND itemid = 2388146);

-- CLEANDB source row 36187.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 9990415, 2388163, 1, 1, 0, 100000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 9990415 AND itemid = 2388163);

-- CLEANDB source row 36188.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 9995009, 2388162, 1, 1, 0, 100000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 9995009 AND itemid = 2388162);

-- CLEANDB source row 36189.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 8880150, 2388160, 1, 1, 0, 100000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 8880150 AND itemid = 2388160);

-- CLEANDB source row 36190.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 9990301, 2388161, 1, 1, 0, 100000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 9990301 AND itemid = 2388161);

-- CLEANDB source row 36191.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 8880302, 2388161, 1, 1, 0, 100000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 8880302 AND itemid = 2388161);

-- CLEANDB source row 36192.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 8645009, 2388162, 1, 1, 0, 100000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 8645009 AND itemid = 2388162);

-- CLEANDB source row 36193.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 8880415, 2388163, 1, 1, 0, 100000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 8880415 AND itemid = 2388163);

-- CLEANDB source row 36196.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 8880002, 2388164, 1, 1, 0, 100000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 8880002 AND itemid = 2388164);

-- CLEANDB source row 36197.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 9990150, 2388160, 1, 1, 0, 100000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 9990150 AND itemid = 2388160);

-- CLEANDB source row 36201.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 8847777, 1142500, 1, 1, 0, 100000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 8847777 AND itemid = 1142500);

-- CLEANDB source row 36202.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 8850012, 1142635, 1, 1, 0, 100000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 8850012 AND itemid = 1142635);

-- CLEANDB source row 36203.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 9420522, 1142326, 1, 1, 0, 200000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 9420522 AND itemid = 1142326);

-- CLEANDB source row 36204.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 9990150, 1143000, 1, 1, 0, 50000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 9990150 AND itemid = 1143000);

-- CLEANDB source row 36205.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 9990301, 1143102, 1, 1, 0, 50000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 9990301 AND itemid = 1143102);

-- CLEANDB source row 36206.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 9995009, 1143141, 1, 1, 0, 50000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 9995009 AND itemid = 1143141);

-- CLEANDB source row 36207.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 9990415, 1143139, 1, 1, 0, 50000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 9990415 AND itemid = 1143139);

-- CLEANDB source row 36208.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 8880150, 1142802, 1, 1, 0, 20000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 8880150 AND itemid = 1142802);

-- CLEANDB source row 36209.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 8880302, 1142803, 1, 1, 0, 20000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 8880302 AND itemid = 1142803);

-- CLEANDB source row 36210.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 8645009, 1142880, 1, 1, 0, 20000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 8645009 AND itemid = 1142880);

-- CLEANDB source row 36211.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 8880415, 1142558, 1, 1, 0, 20000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 8880415 AND itemid = 1142558);

-- CLEANDB source row 36212.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 8880002, 1142520, 1, 1, 0, 25000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 8880002 AND itemid = 1142520);

-- CLEANDB source row 36219.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 8847777, 1032183, 1, 1, 0, 80000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 8847777 AND itemid = 1032183);

-- Prerequisite item acquisition.

-- CLEANDB source row 35754.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 8610022, 4032922, 1, 1, 31125, 1000000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 8610022 AND itemid = 4032922);

-- CLEANDB source row 35760.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 8610000, 4000660, 1, 1, 0, 500000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 8610000 AND itemid = 4000660);

-- CLEANDB source row 35761.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 8610001, 4000661, 1, 1, 0, 500000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 8610001 AND itemid = 4000661);

-- CLEANDB source row 35762.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 8610002, 4000662, 1, 1, 0, 500000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 8610002 AND itemid = 4000662);

-- CLEANDB source row 35763.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 8610003, 4000663, 1, 1, 0, 500000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 8610003 AND itemid = 4000663);

-- CLEANDB source row 35764.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 8610004, 2430200, 1, 1, 0, 250000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 8610004 AND itemid = 2430200);

-- CLEANDB source row 35766.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 8210004, 4032836, 1, 1, 3174, 250000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 8210004 AND itemid = 4032836);

-- CLEANDB source row 35767.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 8210000, 4032838, 1, 1, 3177, 250000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 8210000 AND itemid = 4032838);

-- CLEANDB source row 35768.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 8210001, 4032838, 1, 1, 3177, 250000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 8210001 AND itemid = 4032838);

-- CLEANDB source row 35769.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 8210002, 4032838, 1, 1, 3177, 250000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 8210002 AND itemid = 4032838);

-- CLEANDB source row 35770.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 8210003, 4032838, 1, 1, 3177, 250000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 8210003 AND itemid = 4032838);

-- CLEANDB source row 35771.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 8210004, 4032838, 1, 1, 3177, 250000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 8210004 AND itemid = 4032838);

-- CLEANDB source row 35772.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 8210005, 4032838, 1, 1, 3177, 250000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 8210005 AND itemid = 4032838);

-- CLEANDB source row 35773.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 8210006, 4032838, 1, 1, 3177, 250000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 8210006 AND itemid = 4032838);

-- CLEANDB source row 35774.
INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)
SELECT 8210007, 4032838, 1, 1, 3177, 250000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = 8210007 AND itemid = 4032838);

-- Twelve source Monster Book cover mappings. SQL cover identity and the
-- native item info/mob are distinct consumers; preserve the source mismatch
-- for cards 2388160..2388163 rather than silently replacing either identity.

-- CLEANDB source line 21557.
INSERT INTO monstercarddata (cardid, mobid)
SELECT 2388146, 8840000 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM monstercarddata WHERE cardid = 2388146);

-- CLEANDB source line 21558.
INSERT INTO monstercarddata (cardid, mobid)
SELECT 2388147, 8850005 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM monstercarddata WHERE cardid = 2388147);

-- CLEANDB source line 21559.
INSERT INTO monstercarddata (cardid, mobid)
SELECT 2388148, 8850006 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM monstercarddata WHERE cardid = 2388148);

-- CLEANDB source line 21560.
INSERT INTO monstercarddata (cardid, mobid)
SELECT 2388149, 8850007 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM monstercarddata WHERE cardid = 2388149);

-- CLEANDB source line 21561.
INSERT INTO monstercarddata (cardid, mobid)
SELECT 2388150, 8850008 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM monstercarddata WHERE cardid = 2388150);

-- CLEANDB source line 21562.
INSERT INTO monstercarddata (cardid, mobid)
SELECT 2388151, 8850009 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM monstercarddata WHERE cardid = 2388151);

-- CLEANDB source line 21563.
INSERT INTO monstercarddata (cardid, mobid)
SELECT 2388152, 8850011 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM monstercarddata WHERE cardid = 2388152);

-- CLEANDB source line 21564.
INSERT INTO monstercarddata (cardid, mobid)
SELECT 2388159, 9400408 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM monstercarddata WHERE cardid = 2388159);

-- CLEANDB source line 21681.
INSERT INTO monstercarddata (cardid, mobid)
SELECT 2388160, 9990150 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM monstercarddata WHERE cardid = 2388160);

-- CLEANDB source line 21682.
INSERT INTO monstercarddata (cardid, mobid)
SELECT 2388161, 9990301 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM monstercarddata WHERE cardid = 2388161);

-- CLEANDB source line 21683.
INSERT INTO monstercarddata (cardid, mobid)
SELECT 2388162, 9995009 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM monstercarddata WHERE cardid = 2388162);

-- CLEANDB source line 21684.
INSERT INTO monstercarddata (cardid, mobid)
SELECT 2388163, 9990415 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM monstercarddata WHERE cardid = 2388163);

-- Explicit derived consumer fix, NOT an original CLEANDB mapping:
-- Magnus card 2388164 is dropped by 8880002 and genuine RAW item
-- info/mob is 8880002. A missing SQL mapping otherwise null-unboxes when
-- character-info serializes a selected cover, including after relog.
INSERT INTO monstercarddata (cardid, mobid)
SELECT 2388164, 8880002 FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM monstercarddata WHERE cardid = 2388164);
