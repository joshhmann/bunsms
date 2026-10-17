/* MapleRoot 3003903: genuine leader-triggered boss summon in the instance-owned map. */
const ExpeditionType = Java.type('server.expeditions.ExpeditionType');
var status = 0;
function start() { action(1, 0, 0); }
function action(mode, type, selection) {
    var expedition = cm.getExpedition(ExpeditionType.CYGNUS);
    var eim = cm.getEventInstance();
    if (mode != 1 || eim == null || eim.isEventCleared() || cm.getMapId() != 271040100
            || expedition == null || !expedition.isLeader(cm.getPlayer()) || eim.getProperty('boss') != '0') {
        cm.dispose();
        return;
    }
    if (status == 0) {
        status = 1;
        cm.sendYesNo("Dark energy emanates from her, are you sure you want to disturb her sleep?");
        return;
    }
    eim.setProperty('boss', '1');
    cm.getMap().spawnMonsterOnGroundBelow(8850011, -104, 115);
    cm.getMap().destroyNPC(3003903);
    cm.getMap().killMonster(8840010);
    cm.dispose();
}
