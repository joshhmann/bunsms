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

	Only displayed snapshots in slots 1..96 can be sold. The backend
	 validates their identity and quantity before one guarded batch sale;
	 protected and nonpositive-price items are skipped.
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
var displayedSnapshot;
var lastItemSlot = 96;

function start() {
    status = -1;
    inventoryType = null;
    displayedSnapshot = null;
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
    var selectionOptionsString = "Hello, I am the #bDonation Box#k! I can sell eligible items in slots 1 through 96 of your inventory. ";
    for (var i = 0; i < options.length; i++) {
        var inventoryOption = options[i];
        selectionOptionsString += "\r\n#L" + inventoryOption + "# " + InventoryTypeOptions.StringMap[inventoryOption] + "#l";
    }
    selectionOptionsString += "\r\n#L5#Search monster drops or item sources.#l";
    cm.sendSimple(selectionOptionsString);
}

function handleInventoryStartSelectionStatus(selection) {
    if (selection === 5) {
        cm.dispose();
        cm.openNpc(9000041, 'search');
        return;
    }
    if (selection !== Math.floor(selection) || options.indexOf(selection) === -1) {
        cm.dispose();
        return;
    }
    inventoryType = InventoryType.getByType(selection);
    displayedSnapshot = cm.getPlayer().snapshotItemsForSale(inventoryType, 1, lastItemSlot);
    if (displayedSnapshot.size() === 0) {
        cm.sendOk("There are no items in slots 1 through " + lastItemSlot + " of that inventory.");
        cm.dispose();
        return;
    }
    var selectionString = createInventoryItemsString(displayedSnapshot,
        "Which displayed slot do you want to start selling from? Only eligible displayed items from that slot through slot " + lastItemSlot + " will be sold.\r\n"
        + "Cash items, pets, quest items, wedding items and items without a positive sale price will be skipped.\r\n");
    cm.sendSimple(selectionString);
}

function handleTransactionStatus(selection) {
    if (displayedSnapshot === null || selection !== Math.floor(selection)
            || selection < 1 || selection > lastItemSlot || !isDisplayedSlot(selection)) {
        cm.dispose();
        return;
    }
    var ii = ItemInformationProvider.getInstance();
    var transactionResult = cm.getPlayer().sellAllItemsFromPosition(
        ii, inventoryType, selection, lastItemSlot, displayedSnapshot);
    var transactionMessage;
    if (transactionResult > 0) {
        transactionMessage = "Transaction complete! You received #r" + cm.numberWithCommas(transactionResult) + " mesos#k from this action.";
    } else if (transactionResult === 0) {
        transactionMessage = "No mesos were credited. Protected items and items without a positive sale price were skipped.";
    } else {
        transactionMessage = "Nothing was sold. The displayed items changed or the sale could not be completed. Please try again.";
    }
    cm.sendOk(transactionMessage);
    cm.dispose();
}

function isDisplayedSlot(slot) {
    for (var i = 0; i < displayedSnapshot.size(); i++) {
        if (displayedSnapshot.get(i).getPosition() === slot) {
            return true;
        }
    }
    return false;
}

function createInventoryItemsString(snapshot, initialMessage) {
    var selectionString = initialMessage;
    for (var i = 0; i < snapshot.size(); i++) {
        var item = snapshot.get(i);
        selectionString += "#L" + item.getPosition() + "##i" + item.getItemId() + "# x" + item.getQuantity() + "#l   ";
        if ((i + 1) % 4 === 0) {
            selectionString += "\r\n";
        }
    }
    return selectionString;
}
