function enter(pi) {
    if (pi.isQuestStarted(31124) || pi.isQuestStarted(31125)) {
        if (pi.isQuestStarted(31124)) {
            pi.setQuestProgress(31124, "1");
            pi.getPlayer().dropMessage(5, "I have scouted the Stronghold. I should report back to Chief Alex.");
        }
	    pi.playPortalSound();
        pi.warp(271030010, "out00");
	    return true;
    }
    if (pi.isQuestCompleted(31125)) {
        pi.playPortalSound();
        pi.warp(271030000, "west00");
        return true;

    } else {
        pi.getPlayer().dropMessage(5, "I should speak to Chief Alex first before entering this area.");
        return false;
    }
}
