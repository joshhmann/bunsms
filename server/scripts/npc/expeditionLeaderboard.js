/* MapleRoot ExpeditionLeaderboardInteraction, adapted to Cosmic's existing cm API.
 * No source interaction framework is required. Source party timing/damage data is persistent.
 */
const BossLogEntry = Java.type('server.expeditions.ExpeditionBossLog$BossLogEntry');
const ExpeditionLeaderboard = Java.type('server.expeditions.ExpeditionLeaderboard');
var status = 0;
var personal = false;
var bosses = BossLogEntry.values();

function start() {
    cm.sendSimple('Which expedition leaderboard would you like to see?\r\n#L0#Global top 10 parties#l\r\n#L1#Your top 3 parties#l');
}

function action(mode, type, selection) {
    if (mode != 1) {
        cm.dispose();
        return;
    }
    if (status == 0) {
        if (selection != 0 && selection != 1) {
            cm.dispose();
            return;
        }
        personal = selection == 1;
        var menu = 'Select an expedition:\r\n';
        for (var i = 0; i < bosses.length; i++) {
            menu += '#L' + i + '#' + bosses[i].name() + '#l\r\n';
        }
        status = 1;
        cm.sendSimple(menu);
    } else if (status == 1) {
        if (selection < 0 || selection >= bosses.length) {
            cm.dispose();
            return;
        }
        var boss = bosses[selection];
        status = 2;
        cm.sendOk(personal
            ? ExpeditionLeaderboard.getPersonalLeaderboardStringForBoss(cm.getPlayer().getId(), boss)
            : ExpeditionLeaderboard.getGlobalLeaderboardStringForBoss(boss));
    } else {
        cm.dispose();
    }
}
