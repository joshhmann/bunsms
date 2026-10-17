/* MapleRoot VerusEnter; accepted level-200 policy replaces the excluded Rebirth gate. */
function enter(pi) {
    if ((pi.getPlayer().gmLevel() >= 2 || pi.getPlayer().getLevel() >= 200) && pi.isQuestCompleted(31164)) {
        pi.warp(450011660, 0);
        return true;
    }
    pi.getPlayer().dropMessage(5, 'You must be level 200 and complete #q31164# to enter.');
    return false;
}
