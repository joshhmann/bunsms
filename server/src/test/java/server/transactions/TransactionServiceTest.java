package server.transactions;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Buyback ledger seams that run without WZ/DB: the MAX=0 early-out (service
 * short-circuits before touching the DB) and the tint-carrying
 * TransactionItem/TransactionEquip POJO round-trip through the pure mappers.
 * No source-string or file-content assertions; no opcode coverage.
 * The conditional-claim SQL race needs a live DB (no DB harness in this
 * module — no H2/testcontainers/jdbc), so it is proven by the lead's fresh +
 * re-applied DB run, not by a test here.
 */
class TransactionServiceTest {

    @Test
    void tintFieldsMapFromEquipToLedgerRow() {
        // Sell-path seam (Shop.recordSellForBuyback -> convertItemsToTransactionItems):
        // a Mockito Equip avoids the WZ-backed Equip constructor while still
        // exercising the real mapper, including the six tint fields.
        client.inventory.Equip equip = org.mockito.Mockito.mock(client.inventory.Equip.class);
        org.mockito.Mockito.when(equip.getItemType()).thenReturn((byte) 1);
        org.mockito.Mockito.when(equip.getInventoryType()).thenReturn(client.inventory.InventoryType.EQUIP);
        org.mockito.Mockito.when(equip.getTintHue()).thenReturn((short) 120);
        org.mockito.Mockito.when(equip.getTintChroma()).thenReturn((byte) 40);
        org.mockito.Mockito.when(equip.getTintBright()).thenReturn((byte) -10);
        org.mockito.Mockito.when(equip.getTintFxHue()).thenReturn((short) 200);
        org.mockito.Mockito.when(equip.getTintFxChroma()).thenReturn((byte) 30);
        org.mockito.Mockito.when(equip.getTintFxBright()).thenReturn((byte) 5);
        TransactionEquip back = (TransactionEquip) TransactionService.convertItemsToTransactionItems(
                List.of(equip)).get(0);
        assertEquals(120, back.getTintHue());
        assertEquals(40, back.getTintChroma());
        assertEquals(-10, back.getTintBright());
        assertEquals(200, back.getTintFxHue());
        assertEquals(30, back.getTintFxChroma());
        assertEquals(5, back.getTintFxBright());
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
}
