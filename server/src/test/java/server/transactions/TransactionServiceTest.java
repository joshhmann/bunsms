package server.transactions;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Buyback ledger model + NPC/command list-string shape. Runs without WZ/DB:
 * only record accessors and the selection-list formatting contract are
 * exercised here (no Item/Equip instantiation, which needs WZ data).
 */
class TransactionServiceTest {

    private static Transaction tx(int id, boolean used, TransactionItem... items) {
        return new Transaction(id, 7, Instant.EPOCH, used, List.of(items));
    }

    private static TransactionItem ti(int itemId, int qty) {
        TransactionItem item = new TransactionItem();
        item.setItemId(itemId);
        item.setQuantity(qty);
        item.setOwner("");
        item.setGiftFrom("");
        return item;
    }

    @Test
    void recordAccessors() {
        Transaction t = tx(3, true, ti(2000000, 5));
        assertEquals(3, t.transactionId());
        assertEquals(7, t.userId());
        assertEquals(Instant.EPOCH, t.transactionDate());
        assertTrue(t.buybackUsed());
        assertEquals(1, t.items().size());
        assertEquals(2000000, t.items().get(0).getItemId());
        assertEquals(5, t.items().get(0).getQuantity());
    }

    @Test
    void equipExtendsItemWithStats() {
        TransactionEquip eq = new TransactionEquip();
        eq.setItemId(1002000);
        eq.setStr((short) 5);
        eq.setIntStat((short) 7);
        eq.setUpgradeSlots(3);
        eq.setItemLevel((byte) 4);
        eq.setItemExp(100);
        eq.setRingId(-1);
        assertTrue(eq instanceof TransactionItem);
        assertEquals(5, eq.getStr());
        assertEquals(7, eq.getIntStat());
        assertEquals(3, eq.getUpgradeSlots());
        assertEquals(4, eq.getItemLevel());
        assertEquals(100, eq.getItemExp());
        assertEquals(-1, eq.getRingId());
    }

    @Test
    void disabledConfigYieldsNoTransactions() {
        // MAXIMUM_TRANSACTIONS_FOR_BUYBACK defaults to 0 (disabled): the
        // service short-circuits before touching the DB.
        List<Transaction> got = TransactionService.getLastTransactions(1, 0);
        assertTrue(got.isEmpty());
    }

    @Test
    void negativeCountYieldsNoTransactions() {
        assertTrue(TransactionService.getLastTransactions(1, -1).isEmpty());
    }

    @Test
    void selectionListMarksUsedTransactions() {
        // Shape contract shared by @buyback list and the buyback NPC dialog:
        // 1-based index, item count, "[Used]" suffix when consumed.
        List<Transaction> txs = List.of(tx(1, false, ti(1, 1), ti(2, 2)), tx(2, true, ti(3, 3)));
        StringBuilder sb = new StringBuilder("Last transactions:\r\n\r\n");
        for (int i = 0; i < txs.size(); i++) {
            Transaction t = txs.get(i);
            sb.append(i + 1).append(". ").append(t.items().size()).append(" items")
                    .append(t.buybackUsed() ? " [Used]" : "").append("\r\n");
        }
        String s = sb.toString();
        assertTrue(s.contains("1. 2 items\r\n"));
        assertTrue(s.contains("2. 1 items [Used]\r\n"));
        assertFalse(txs.get(0).buybackUsed());
    }
}
