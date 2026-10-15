package server.transactions;

import java.time.Instant;
import java.util.List;

/**
 * One recorded sell event: the items sold together plus whether the
 * buyback for this batch was already consumed.
 */
public record Transaction(int transactionId, int userId, Instant transactionDate,
                          boolean buybackUsed, List<TransactionItem> items) {
}
