/* MapleRoot Informant: original five Hallowed Ground destinations, same 31151 gate for direct clicks and portal entry. */
var status = 0;
var names = ['Dawn', 'Blaze', 'Wind', 'Night', 'Thunder'];
function start() {
    if (!cm.isQuestCompleted(31151)) {
        cm.sendOk('Complete the Dream Key quest before entering the Hallowed Grounds.');
        cm.dispose();
        return;
    }
    var menu = 'Which Hallowed Ground would you like to visit?\r\n';
    for (var i = 0; i < names.length; i++) menu += '#L' + i + '#Hallowed Ground of ' + names[i] + '#l\r\n';
    cm.sendSimple(menu);
}
function action(mode, type, selection) {
    if (mode == 1 && cm.isQuestCompleted(31151) && selection >= 0 && selection < names.length && selection == Math.floor(selection)) {
        cm.warp(271030201 + selection, 1);
    }
    cm.dispose();
}
