/* MapleRoot 9010002 Boss Maps transport, preserving the stock greeting.
 * Destination comes from the source's ungated Boss Maps list.
 */
var status = 0;

function start() {
    cm.sendSimple("Hi, I'm #p9010002#.\r\nWhere would you like to go?\r\n#L1##m541020700# (Krexel)#l");
}

function action(mode, type, selection) {
    if (mode != 1) {
        cm.dispose();
        return;
    }
    if (status == 0 && selection == 1) {
        status = 1;
        cm.sendYesNo("Do you want to go to #m541020700#?");
    } else if (status == 1) {
        cm.warp(541020700, 0);
        cm.dispose();
    } else {
        cm.dispose();
    }
}