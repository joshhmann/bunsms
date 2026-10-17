package server.transactions;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertTrue;

/** Disabled-history policy without a database; real ledger cases are integration tests. */
class TransactionServiceTest {


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
