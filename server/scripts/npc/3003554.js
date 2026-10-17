/* MapleRoot 3003554: genuine leader-triggered boss summon in the instance-owned map. */
const ExpeditionType = Java.type('server.expeditions.ExpeditionType');
var status = 0;
function start() { action(1, 0, 0); }
function action(mode, type, selection) {
    var expedition = cm.getExpedition(ExpeditionType.VERUS);
    var eim = cm.getEventInstance();
    if (mode != 1 || eim == null || eim.isEventCleared() || cm.getMapId() != 450010100
            || expedition == null || !expedition.isLeader(cm.getPlayer()) || eim.getProperty('boss') != '0') {
        cm.dispose();
        return;
    }
    if (status == 0) {
        status = 1;
        cm.sendYesNo("My Queen...you don't think you can take on her do you?...");
        return;
    }
    eim.setProperty('boss', '1');
    cm.getMap().spawnMonsterOnGroundBelow(8880415, 0, 266);
    cm.getMap().destroyNPC(3003554);
    cm.dispose();
}
