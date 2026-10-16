/* MapleRoot MagnusEnter: accepted non-rebirth entry policy retains quest31166. */
function enter(pi) {
    if (pi.getPlayer().getLevel() >= 200 && pi.isQuestCompleted(31166)) {
        pi.playPortalSound();
        pi.warp(401053002);
        return true;
    }
    pi.playerMessage(5, "You must be level 200 and complete New Beginnings first.");
    return false;
}
