/*
    This file is part of the HeavenMS MapleStory Server
    Copyleft (L) 2016 - 2019 RonanLana

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as
    published by the Free Software Foundation version 3 as published by
    the Free Software Foundation. You may not use, modify or distribute
    this program under any other version of the GNU Affero General Public
    License.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/
/* NPC: Donation Box (9000041)
	Victoria Road : Henesys

	Quicksell NPC, ported from MapleRoot Full Repack's
	Server/scripts/npc/quicksell.js (Ronan Lana, then PumpkinPie).

	Adaptation note: our Character backend has no sellAllPosLast
	 ranged sell, so this sells from the chosen start slot through
	 the end of the tab via sellAllItemsFromPosition instead of a
	 start..end range. No other backend calls were needed.
*/

var InventoryType = Java.type('client.inventory.InventoryType');
var ItemInformationProvider = Java.type('server.ItemInformationProvider');

var InventoryTypeOptions = {
    StringMap: {
        1: "Equip",
        2: "Use",
        3: "Setup",
        4: "Etc"
    },
    Equip: 1,
    Use: 2,
    Setup: 3,
    Etc: 4
};
var options = [InventoryTypeOptions.Equip, InventoryTypeOptions.Use, InventoryTypeOptions.Setup, InventoryTypeOptions.Etc];

var status;
var inventoryType;
var inventory;
var firstItemSlot;
var lastItemSlot = 96;

function start() {
    status = -1;
    action(1, 0, 0);
}

function action(mode, type, selection) {
    status++;

    if (mode !== 1) {
        cm.dispose();
        return;
    }

    if (status === 0) {
        handleInitialStatus();
    } else if (status === 1) {
        handleInventoryStartSelectionStatus(selection);
    } else if (status === 2) {
        handleTransactionStatus(selection);
    }
}

function handleInitialStatus() {
    var selectionOptionsString = "Hello, I am the #bDonation Box#k! I can clear your inventory of junk or glitched items by selling them all. ";
    for (var i = 0; i < options.length; i++) {
        var inventoryOption = options[i];
        selectionOptionsString += "\r\n#L" + inventoryOption + "# " + InventoryTypeOptions.StringMap[inventoryOption] + "#l";
    }
    cm.sendSimple(selectionOptionsString);
}

function handleInventoryStartSelectionStatus(selection) {
    inventoryType = InventoryType.getByType(selection);
    inventory = cm.getPlayer().getInventory(inventoryType);
    var selectionString = createInventoryItemsString(inventory, 0, lastItemSlot, "Which slot in your inventory do you want to start selling from? Everything from that slot to the end of the tab will be sold.\r\n");
    cm.sendSimple(selectionString);
}

function handleTransactionStatus(selection) {
    firstItemSlot = selection;
    var ii = ItemInformationProvider.getInstance();
    var transactionResult = cm.getPlayer().sellAllItemsFromPosition(ii, inventoryType, firstItemSlot);
    var transactionMessage;
    if (transactionResult > 0) {
        transactionMessage = "Transaction complete! You received #r" + cm.numberWithCommas(transactionResult) + " mesos#k from this action.";
    } else {
        transactionMessage = "There was nothing to sell from that slot onward, please try again.";
    }
    cm.sendOk(transactionMessage);
    cm.dispose();
}

function createInventoryItemsString(inventory, startSlot, endSlot, initialMessage) {
    var selectionString = initialMessage;
    var formatCounter = 0;
    for (var itemSlot = startSlot; itemSlot <= endSlot; itemSlot++) {
        var result = appendItemString(inventory, itemSlot, selectionString, formatCounter);
        selectionString = result.selectionString;
        formatCounter = result.formatCounter;
    }
    return selectionString;
}

function appendItemString(inventory, itemSlot, selectionString, formatCounter) {
    if (inventory.getItem(itemSlot) !== null) {
        selectionString += "#L" + itemSlot + "##i" + inventory.getItem(itemSlot).getItemId() + "#   ";
        formatCounter++;
        if (formatCounter % 4 === 0) {
            selectionString += "\r\n";
        }
    }
    return { selectionString: selectionString, formatCounter: formatCounter };
}
