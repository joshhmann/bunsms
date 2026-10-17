-- Genuine ordinary Von Leon prechain/prison prerequisites omitted from the first
-- expedition acquisition union. MapleRoot Database/CLEANDB.sql rows35776/2000;
-- source IDs are provenance only, never imported as database-local primary keys.
-- Preserve existing custom pair definitions and make replay idempotent.
INSERT INTO drop_data (dropperid,itemid,minimum_quantity,maximum_quantity,questid,chance)
SELECT 8210005,4032835,1,1,3170,250000
WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid=8210005 AND itemid=4032835 AND questid=3170);

INSERT INTO reactordrops (reactorid,itemid,chance,questid)
SELECT 9212000,4032860,4,-1
WHERE NOT EXISTS (SELECT 1 FROM reactordrops WHERE reactorid=9212000 AND itemid=4032860 AND questid=-1);
