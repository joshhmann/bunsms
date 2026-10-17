/* MapleRoot Thunder Stone 2430200: genuine 5x four stones + one Thunder Stone recipe. */
const InventoryType = Java.type('client.inventory.InventoryType');
const Arrays = Java.type('java.util.Arrays');
const Integer = Java.type('java.lang.Integer');
function start() {
    var use = im.getInventory(InventoryType.USE);
    var etc = im.getInventory(InventoryType.ETC);
    use.lockInventory();
    etc.lockInventory();
    try {
        var inputs = [4000660, 4000661, 4000662, 4000663, 2430200];
        var quantities = [5, 5, 5, 5, 1];
        for (var i = 0; i < inputs.length; i++) {
            if (!im.hasItem(inputs[i], quantities[i])) {
                im.playerMessage(5, 'You need 5 of each stone and one Thunder Stone to craft a Dream Key.');
                return;
            }
        }
        if (im.hasItem(4032923)) {
            im.playerMessage(5, 'You already have a Dream Key.');
            return;
        }
        var addIds = Arrays.asList(Integer.valueOf(4032923));
        var addQty = Arrays.asList(Integer.valueOf(1));
        var removeIds = Arrays.asList(Java.to(inputs, 'java.lang.Integer[]'));
        var removeQty = Arrays.asList(Java.to(quantities, 'java.lang.Integer[]'));
        if (!im.canHoldAllAfterRemoving(addIds, addQty, removeIds, removeQty)) {
            im.playerMessage(5, 'Make room in your ETC inventory for the Dream Key. No stones were consumed.');
            return;
        }
        for (var j = 0; j < inputs.length; j++) im.gainItem(inputs[j], -quantities[j]);
        if (im.gainItem(4032923, 1, false, true) == null) {
            for (var k = 0; k < inputs.length; k++) im.gainItem(inputs[k], quantities[k]);
            im.playerMessage(5, 'The Dream Key could not be added. Your stones were returned.');
            return;
        }
        im.playerMessage(5, 'You have obtained the Dream Key.');
    } finally {
        etc.unlockInventory();
        use.unlockInventory();
        im.dispose();
    }
}
