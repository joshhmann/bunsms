/* MapleRoot garden scouting and consumable Dream Key entrance. */
function enter(pi) {
    if (pi.isQuestStarted(31149)) {
        // Record the actual scouting action; Alex's normal quest completion runs
        // the original WZ EXP/next-quest actions once, instead of force-completing.
        pi.setQuestProgress(31149, '2');
        pi.getPlayer().dropMessage(5, 'I found the Cygnus Garden. I should report back to Chief Alex.');
        return true;
    }
    if (!pi.haveItem(4032923)) {
        pi.getPlayer().dropMessage(5, 'I need a Dream Key to enter.');
        return false;
    }
    pi.playPortalSound();
    pi.warp(271040000, 'out00');
    pi.gainItem(4032923, -1);
    return true;
}
