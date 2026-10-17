/* MapleRoot 3003921: genuine leader-triggered boss summon in the instance-owned map. */
const ExpeditionType = Java.type('server.expeditions.ExpeditionType');
var status = 0;
function start() { action(1, 0, 0); }
function action(mode, type, selection) {
    var expedition = cm.getExpedition(ExpeditionType.DARKNELL);
    var eim = cm.getEventInstance();
    if (mode != 1 || eim == null || eim.isEventCleared() || cm.getMapId() != 450012210
            || expedition == null || !expedition.isLeader(cm.getPlayer()) || eim.getProperty('boss') != '0') {
        cm.dispose();
        return;
    }
    if (status == 0) {
        status = 1;
        cm.sendYesNo("?????????????????.....");
        return;
    }
    eim.setProperty('boss', '1');
    cm.getMap().spawnMonsterOnGroundBelow(8645009, 359, 29);
    cm.getMap().destroyNPC(3003921);
    cm.dispose();
}
