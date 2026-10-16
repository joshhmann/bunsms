/* MapleRoot WillEnter; accepted level-200 policy replaces the excluded Rebirth gate. */
function enter(pi) {
    if ((pi.getPlayer().gmLevel() >= 2 || pi.getPlayer().getLevel() >= 200) && pi.isQuestCompleted(31162)) {
        pi.warp(450007240, 0);
        return true;
    }
    pi.getPlayer().dropMessage(5, 'You must be level 200 and complete #q31162# to enter.');
    return false;
}
