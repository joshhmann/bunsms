/* Boss-pack Wave 0: Arcane River entry gate.
 * Upstream MapleRoot gated on player.getReborns() >= 3, but this tree has no
 * rebirth system (see HyperTPHandler header note), so the gate is a GM check
 * plus a high-level fallback. Map 450001003 ships in our Map.wz already.
 */
function enter(pi) {
    const player = pi.getPlayer();

    if (player.gmLevel() >= 2 || player.getLevel() >= 200) {
        pi.playPortalSound();
        pi.warp(450001003, 0);
        return true;
    }
    pi.playerMessage(5, "You need to be level 200 to enter Arcane River.");
    return false;
}
