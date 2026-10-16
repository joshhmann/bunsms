package client.command.commands.gm0;

import client.Character;
import client.Client;
import client.command.Command;
import config.YamlConfig;
import constants.game.GameConstants;
import server.responses.SelectionListStringResult;
import server.transactions.Transaction;
import server.transactions.TransactionService;

import java.util.List;

/**
 * Buyback ledger front-end: {@code @buyback} opens the buyback NPC dialog,
 * {@code @buyback list} prints recent sell events, {@code @buyback <n>}
 * buys back the n-th recent sell event.
 */
public class BuyBackCommand extends Command {
    /** NPC hosting the buyback dialog; 9000041 is the shared utility NPC (Donation Box). */
    static final int BUYBACK_NPC_ID = 9000041;
    /** Script selected on that NPC; a standalone buyback.js keeps the quicksell dialog intact. */
    static final String BUYBACK_NPC_SCRIPT = "buyback";

    {
        setDescription("Buys back the last sold items or lists recent transactions for buyback.");
    }

    @Override
    public void execute(Client c, String[] params) {
        Character player = c.getPlayer();

        if (!player.isAlive()) {
            player.dropMessage(6, "This command cannot be used when you're dead.");
            return;
        }

        if (player.getEventInstance() != null) {
            player.dropMessage(6, "This command cannot be used in expeditions or special instances.");
            return;
        }

        try {
            if (params.length == 1 && params[0].equalsIgnoreCase("list")) {
                final List<Transaction> transactions;
                try {
                    transactions = TransactionService.getLastTransactions(player.getId(), YamlConfig.config.server.MAXIMUM_TRANSACTIONS_FOR_BUYBACK);
                } catch (IllegalStateException e) {
                    player.dropMessage(6, "Could not load transaction history. Please try again later.");
                    return;
                }

                if (transactions.isEmpty()) {
                    player.dropMessage(6, "There are no previous transactions at this time.");
                    return;
                }

                StringBuilder stringBuilder = new StringBuilder("Last transactions:\r\n\r\n");
                for (int i = 0; i < transactions.size(); i++) {
                    Transaction transaction = transactions.get(i);
                    int totalItems = transaction.items().size();
                    String quote = transaction.creditedMesos() == null ? "unavailable: sale credit not recorded"
                            : GameConstants.numberWithCommas(transaction.creditedMesos()) + " mesos";

                    String suffix = transaction.buybackUsed() ? " [Used]" : "";

                    stringBuilder.append(transaction.transactionId()).append(". ").append(totalItems).append(" items (").append(quote).append(")").append(suffix).append("\r\n");
                }

                player.dropMessage(6, stringBuilder.toString());
                return;
            }

            switch (params.length) {
                case 0:
                    c.getAbstractPlayerInteraction().openNpc(BUYBACK_NPC_ID, BUYBACK_NPC_SCRIPT);
                    break;
                case 1:
                {
                    String resultMessage = tryProcessTransaction(params, player);

                    player.dropMessage(6, resultMessage);
                    break;
                }
                default:
                    player.dropMessage(6, "Usage: @buyback [list|<saleId>]");
                    break;
            }
        } catch (Exception e) {
            player.dropMessage(6, "An error occurred while processing the buyback. Please try again later.");
        }
    }

    private static String tryProcessTransaction(String[] params, Character player) {
        int transactionId;

        try {
            transactionId = Integer.parseInt(params[0]);
        } catch (NumberFormatException e) {
            return "Invalid transaction number.";
        }

        if (transactionId < 1) {
            return "Invalid transaction number.";
        }

        SelectionListStringResult result = TransactionService.processTransaction(player, transactionId);
        return result.getMessage();
    }
}
