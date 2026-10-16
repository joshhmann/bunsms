/* MapleRoot ordinary travel, restricted to the accepted expedition approaches.
 * The original Krexel choice stays at 1; no unrelated donor-world menu import.
 */
var status = 0;
var destination = 0;
var approaches = [271010000, 450003000, 450007040, 450011120, 450012300, 450011660];

function start() {
    cm.sendSimple("Hi, I'm #p9010002#.\r\nWhere would you like to go?\r\n"
        + "#L1##m541020700# (Krexel)#l\r\n#L2##m800040401# (Castellan)#l\r\n"
        + "#L3##m211042400# (Lion King's Castle approach)#l\r\n"
        + "#L10##m401000000# (Grandis/Magnus approach)#l\r\n#L11#Arcane River and Future Towns#l");
}

function action(mode, type, selection) {
    if (mode != 1) {
        cm.dispose();
        return;
    }
    if (status == 0) {
        if (selection == 1) destination = 541020700;
        else if (selection == 2) destination = 800040401;
        else if (selection == 3) destination = 211042400;
        else if (selection == 10 || selection == 11) {
            if (cm.getPlayer().getLevel() < 200 && cm.getPlayer().gmLevel() < 2) {
                cm.sendOk('You must be level 200 to access Grandis or the Arcane River.');
                cm.dispose();
                return;
            }
            if (selection == 10) destination = 401000000;
            else {
                status = 2;
                var text = 'Choose an approach. The original quest gates still apply:\r\n';
                for (var i = 0; i < approaches.length; i++) text += '#L' + i + '##m' + approaches[i] + '##l\r\n';
                cm.sendSimple(text);
                return;
            }
        } else {
            cm.dispose();
            return;
        }
    } else if (status == 2) {
        if (selection < 0 || selection >= approaches.length || selection != Math.floor(selection)) {
            cm.dispose();
            return;
        }
        destination = approaches[selection];
    } else if (status == 1) {
        cm.warp(destination, 0);
        cm.dispose();
        return;
    }
    status = 1;
    cm.sendYesNo('Do you want to go to #m' + destination + '#?');
}