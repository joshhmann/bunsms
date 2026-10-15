/* NPC Buyback:
 * @author PumpkinPie
 *
 * Standalone dialog for the @buyback command: lists recent sell events,
 * confirms the selected batch, then buys the items back for their NPC
 * sell price. Runs alongside 9000041.js (quicksell) on the same NPC id;
 * the command selects this script explicitly so neither dialog clobbers
 * the other.
 */

var TransactionService = Java.type('server.transactions.TransactionService');

var status;
var selectedTransactionIndex;

function start() {
    status = -1;
    action(1, 0, 0);
}

function action(mode, type, selection) {
    if (mode !== 1) {
        cm.dispose();
        return;
    }
    status++;

    if (status === 0) {
        handleInitialStatus();
    } else if (status === 1) {
        handleConfirmTransaction(selection);
    } else if (status === 2) {
        handleProcessTransaction(selection);
    }
}

function handleInitialStatus() {
    var selectionString = "#bBuyback#n\r\n\r\n";

    var result = TransactionService.getTransactionSelectionListString(cm.getPlayer().getId());

    if (!result.getResult()) {
        cm.sendOk(result.getMessage());
        cm.dispose();
        return;
    }

    selectionString += result.getMessage();
    cm.sendSimple(selectionString);
}

function handleConfirmTransaction(selection) {
    selectedTransactionIndex = selection;

    var result = TransactionService.getTransactionItemListString(cm.getPlayer().getId(), selectedTransactionIndex);

    if (!result.getResult()) {
        cm.sendPrev(result.getMessage());
        return;
    }

    cm.sendNextPrev(result.getMessage());
}

function handleProcessTransaction(selection) {
    var result = TransactionService.processTransaction(cm.getPlayer(), selectedTransactionIndex);

    if (!result.getResult()) {
        cm.sendOk(result.getMessage());
        cm.dispose();
        return;
    }

    cm.sendOk(result.getMessage());
    status = -1;
}
