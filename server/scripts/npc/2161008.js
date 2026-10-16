/* MapleRoot 2161008: genuine leader-triggered boss summon in the instance-owned map. */
const ExpeditionType = Java.type('server.expeditions.ExpeditionType');
var status = 0;
function start() { action(1, 0, 0); }
function action(mode, type, selection) {
    var expedition = cm.getExpedition(ExpeditionType.VONLEON);
    var eim = cm.getEventInstance();
    if (mode != 1 || eim == null || eim.isEventCleared() || cm.getMapId() != 211070100
            || expedition == null || !expedition.isLeader(cm.getPlayer()) || eim.getProperty('boss') != '0') {
        cm.dispose();
        return;
    }
    if (status == 0) {
        status = 1;
        cm.sendYesNo("Are you the warriors who came to defeat me? Or are you from the Anti Black Mage Alliance? It doesn't matter who you are ... There's no need for chitchatting, if we are sure about eachother's purpose... Bring it on, you fools!");
        return;
    }
    eim.setProperty('boss', '1');
    cm.getMap().spawnMonsterOnGroundBelow(8840000, 49, -181);
    cm.getMap().destroyNPC(2161008);
    cm.getMap().killMonster(8840010);
    cm.dispose();
}
