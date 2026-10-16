/* MapleRoot 3002122: genuine leader-triggered boss summon in the instance-owned map. */
const ExpeditionType = Java.type('server.expeditions.ExpeditionType');
var status = 0;
function start() { action(1, 0, 0); }
function action(mode, type, selection) {
    var expedition = cm.getExpedition(ExpeditionType.LUCID);
    var eim = cm.getEventInstance();
    if (mode != 1 || eim == null || eim.isEventCleared() || cm.getMapId() != 450004750
            || expedition == null || !expedition.isLeader(cm.getPlayer()) || eim.getProperty('boss') != '0') {
        cm.dispose();
        return;
    }
    if (status == 0) {
        status = 1;
        cm.sendYesNo("Sparkles can be seen coming out of the misterious robe, would you like to reveal who is in there?");
        return;
    }
    eim.setProperty('boss', '1');
    cm.getMap().spawnMonsterOnGroundBelow(8880150, 1059, 48);
    cm.getMap().spawnMonsterOnGroundBelow(8880172, 1500, 48);
    cm.getMap().spawnMonsterOnGroundBelow(8880165, 420, 48);
    cm.getMap().destroyNPC(3002122);
    cm.dispose();
}
