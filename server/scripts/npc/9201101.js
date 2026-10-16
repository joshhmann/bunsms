/**
 *9201101 - T-1337
 *@author Ronan
 */

function start() {
    // MapleRoot wave 1 (ticket #5): potion shop 9201101 is stocked by migration
    // 172; open it directly. sendDefault (generic WZ text, never a shop) used
    // to shadow the stocked shop.
    cm.openShopNPC(9201101);
    cm.dispose();
}
