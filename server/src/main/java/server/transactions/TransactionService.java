package server.transactions;

import client.Character;
import client.inventory.Equip;
import client.inventory.InventoryType;
import client.inventory.Item;
import client.inventory.manipulator.InventoryManipulator;
import config.YamlConfig;
import constants.game.GameConstants;
import server.ItemInformationProvider;
import server.responses.SelectionListStringResult;
import soloMapling.Casino.CasinoChipConfig;
import tools.DatabaseConnection;
import tools.Pair;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

/**
 * Buyback ledger over recorded sell events (MapleRoot wave 3 port).
 * Reads are honest: a ledger failure throws IllegalStateException (callers
 * surface an explicit error) instead of degrading to "no transactions".
 * The only early-out is MAXIMUM_TRANSACTIONS_FOR_BUYBACK <= 0 (disabled).
 */
public class TransactionService {

    private TransactionService() {
    }

    /** Total mesos needed to buy a transaction back (sum of NPC sell prices). */
    public static int getTotalPurchasePrice(Transaction transaction) {
        int total = 0;
        ItemInformationProvider ii = ItemInformationProvider.getInstance();
        for (TransactionItem item : transaction.items()) {
            // Casino chips sell at their lossless exchange price, not the generic
            // NPC price — mirrors Shop.sell so buyback price == sell price.
            if (CasinoChipConfig.isCasinoChip(item.getItemId())) {
                total += CasinoChipConfig.getChipPrice(item.getItemId()) * item.getQuantity();
            } else {
                total += ii.getPrice(item.getItemId(), item.getQuantity());
            }
        }
        return total;
    }

    public static SelectionListStringResult getTransactionSelectionListString(int userId) {
        final List<Transaction> transactions;
        try {
            transactions = getLastTransactions(userId, YamlConfig.config.server.MAXIMUM_TRANSACTIONS_FOR_BUYBACK);
        } catch (IllegalStateException e) {
            return new SelectionListStringResult(false, "#rCould not load transaction history. Please try again later.#k");
        }

        if (transactions.isEmpty()) {
            return new SelectionListStringResult(false, "#rThere are no previous transactions at this time.#k");
        }

        StringBuilder stringBuilder = new StringBuilder("Last transactions:\r\n\r\n");
        IntStream.range(0, transactions.size()).forEach(i -> {
            Transaction transaction = transactions.get(i);
            int totalItems = transaction.items().size();
            int totalMesos = getTotalPurchasePrice(transaction);
            String transactionIndicator = transaction.buybackUsed() ? " [Used]" : "";

            String transactionText = String.format("#L%d#%d. %d items (%s mesos)%s\r\n",
                    i,
                    i + 1,
                    totalItems,
                    GameConstants.numberWithCommas(totalMesos),
                    transactionIndicator);

            stringBuilder.append(transactionText);
        });

        return new SelectionListStringResult(true, stringBuilder.toString());
    }

    public static SelectionListStringResult getTransactionItemListString(int userId, int transactionIndex) {
        final List<Transaction> transactions;
        try {
            transactions = getLastTransactions(userId, YamlConfig.config.server.MAXIMUM_TRANSACTIONS_FOR_BUYBACK);
        } catch (IllegalStateException e) {
            return new SelectionListStringResult(false, "#rCould not load transaction history. Please try again later.#k");
        }

        if (transactions.isEmpty()) {
            return new SelectionListStringResult(false, "#rThere are no previous transactions at this time. (haxor?)#k");
        }

        if (transactionIndex < 0 || transactionIndex >= transactions.size()) {
            return new SelectionListStringResult(false, "#rInvalid selection. (haxor?)#k ");
        }

        Transaction transaction = transactions.get(transactionIndex);

        if (transaction.buybackUsed()) {
            return new SelectionListStringResult(false, "This transaction has already been bought back.");
        }

        return getItemListString(transaction);
    }

    private static SelectionListStringResult getItemListString(Transaction transaction) {
        StringBuilder itemListString = new StringBuilder("Are you sure you want to buy back this transaction?\r\n\r\nItems contained in this transaction:\r\n");
        AtomicInteger formatCounter = new AtomicInteger();

        List<String> itemStrings = transaction.items().stream()
                .map(item -> {
                    String suffix = formatCounter.incrementAndGet() % 4 == 0 ? "\r\n" : "";
                    return String.format("#i%s#   %s", item.getItemId(), suffix);
                })
                .collect(Collectors.toList());

        itemListString.append(String.join("", itemStrings));

        return new SelectionListStringResult(true, itemListString.toString());
    }

    public static SelectionListStringResult processTransaction(Character player, int transactionIndex) {
        final List<Transaction> transactions;
        try {
            transactions = getLastTransactions(player.getId(), YamlConfig.config.server.MAXIMUM_TRANSACTIONS_FOR_BUYBACK);
        } catch (IllegalStateException e) {
            return new SelectionListStringResult(false, "Could not load transaction history. Please try again later.");
        }

        if (transactionIndex < 0 || transactionIndex >= transactions.size()) {
            return new SelectionListStringResult(false, "Invalid transaction number.");
        }

        Transaction transaction = transactions.get(transactionIndex);
        if (transaction.buybackUsed()) {
            return new SelectionListStringResult(false, "This transaction has already been bought back.");
        }

        // Hold every player inventory lock in fixed InventoryType order across
        // the whole redeem (same lockInventory/unlockInventory pair the sell and
        // handler paths use; fixed order avoids lock-order inversion with them).
        // This keeps concurrent sellers/redeemers on this character from moving
        // mesos or slots between the claim, the re-validation, the grants, and
        // the charge below.
        List<client.inventory.Inventory> locked = new ArrayList<>();
        for (client.inventory.InventoryType type : client.inventory.InventoryType.values()) {
            if (type == client.inventory.InventoryType.UNDEFINED || type == client.inventory.InventoryType.EQUIPPED) {
                continue;
            }
            client.inventory.Inventory inv = player.getInventory(type);
            if (inv != null) {
                inv.lockInventory();
                locked.add(inv);
            }
        }
        try {
            // Note: `transaction` above is a pre-lock snapshot; the claim below
            // is the authority on whether this redeem proceeds, not this flag.

            // First-claimer gate: only one concurrent redeemer flips
            // buyback_used 0 -&gt; 1; losers see 0 rows affected and abort here.
            if (!claimTransactionBuyback(transaction.transactionId())) {
                return new SelectionListStringResult(false, "This transaction has already been bought back.");
            }

            // Re-validate AFTER the claim while holding the locks: exact stored
            // sale quote (casino override included via getTotalPurchasePrice),
            // mesos, and full capacity as they stand now, not as read earlier.
            int buybackPrice = getTotalPurchasePrice(transaction);
            if (player.getMeso() < buybackPrice) {
                updateTransactionBuybackStatus(transaction.transactionId(), false);
                return new SelectionListStringResult(false, "You don't have enough mesos to complete this buyback");
            }

            List<Pair<Item, InventoryType>> validationList = convertTransactionItemsToItemPairs(transaction.items());
            if (!client.inventory.Inventory.checkSpots(player, validationList)) {
                updateTransactionBuybackStatus(transaction.transactionId(), false);
                return new SelectionListStringResult(false, "You don't have enough space to complete this buyback");
            }

            // Grant loop: abort WITHOUT charging on any failure; the row stays
            // claimed so a partial grant cannot be re-redeemed into dupes —
            // support resolves the stuck row from the ledger (row id is in the
            // message). No unmark here: unmarking after a partial grant would
            // re-open the already-granted items for a second redeem.
            // Limit: a crash between the grant loop and the meso charge below
            // leaves granted items uncharged with no cross-system 2PC to roll
            // them back; support resolves that case from the ledger row.
            List<Item> items = convertTransactionItemsToItems(transaction.items());
            for (Item item : items) {
                if (!InventoryManipulator.addFromDrop(player.getClient(), item, false)) {
                    return new SelectionListStringResult(false, "Interrupted, failed to process some or all items. Transaction " + transaction.transactionId() + " is held claimed; please contact support for assistance.");
                }
            }

            player.gainMeso(-buybackPrice, true);
            return new SelectionListStringResult(true, "Bought back items for " + GameConstants.numberWithCommas(buybackPrice) + " mesos.");
        } finally {
            for (int i = locked.size() - 1; i >= 0; i--) {
                locked.get(i).unlockInventory();
            }
        }
    }

    /**
     * First-claimer gate for a buyback redeem (0 -&gt; 1). Returns true only when
     * this caller won the claim; false means already claimed (or DB error).
     * Reliable only together with the redeem-wide inventory locks in
     * {@link #processTransaction} — the UPDATE decides the winner, the locks
     * keep validation, grants, and charge from interleaving on this character.
     */
    static boolean claimTransactionBuyback(int transactionId) {
        String claimSQL = "UPDATE transactions SET buyback_used = 1 WHERE transaction_id = ? AND buyback_used = 0";
        try (Connection conn = DatabaseConnection.getConnection();
             PreparedStatement preparedStatement = conn.prepareStatement(claimSQL)) {
            preparedStatement.setInt(1, transactionId);
            return preparedStatement.executeUpdate() > 0;
        } catch (SQLException e) {
            return false;
        }
    }

    // ======== MAPPERS ========
    public static List<TransactionItem> convertItemsToTransactionItems(List<Item> items) {
        List<TransactionItem> transactionItems = new ArrayList<>();
        for (Item item : items) {
            TransactionItem transactionItem;
            if (item instanceof Equip equip) {
                TransactionEquip transactionEquip = new TransactionEquip();
                transactionEquip.setUpgradeSlots(equip.getUpgradeSlots());
                transactionEquip.setLevel(equip.getLevel());
                transactionEquip.setStr(equip.getStr());
                transactionEquip.setDex(equip.getDex());
                transactionEquip.setIntStat(equip.getInt());
                transactionEquip.setLuk(equip.getLuk());
                transactionEquip.setHp(equip.getHp());
                transactionEquip.setMp(equip.getMp());
                transactionEquip.setWatk(equip.getWatk());
                transactionEquip.setMatk(equip.getMatk());
                transactionEquip.setWdef(equip.getWdef());
                transactionEquip.setMdef(equip.getMdef());
                transactionEquip.setAcc(equip.getAcc());
                transactionEquip.setAvoid(equip.getAvoid());
                transactionEquip.setHands(equip.getHands());
                transactionEquip.setSpeed(equip.getSpeed());
                transactionEquip.setJump(equip.getJump());
                transactionEquip.setVicious(equip.getVicious());
                transactionEquip.setTintHue(equip.getTintHue());
                transactionEquip.setTintChroma(equip.getTintChroma());
                transactionEquip.setTintBright(equip.getTintBright());
                transactionEquip.setTintFxHue(equip.getTintFxHue());
                transactionEquip.setTintFxChroma(equip.getTintFxChroma());
                transactionEquip.setTintFxBright(equip.getTintFxBright());
                transactionEquip.setItemLevel(equip.getItemLevel());
                transactionEquip.setItemExp(equip.getItemExp());
                transactionEquip.setRingId(equip.getRingId());
                transactionItem = transactionEquip;
            } else {
                transactionItem = new TransactionItem();
            }
            transactionItem.setType(item.getItemType());
            transactionItem.setItemId(item.getItemId());
            transactionItem.setInventoryType(item.getInventoryType().getType());
            transactionItem.setPosition(item.getPosition());
            transactionItem.setQuantity(item.getQuantity());
            transactionItem.setOwner(item.getOwner());
            transactionItem.setPetId(item.getPetId());
            transactionItem.setFlag(item.getFlag());
            transactionItem.setExpiration(item.getExpiration());
            transactionItem.setGiftFrom(item.getGiftFrom());
            transactionItems.add(transactionItem);
        }
        return transactionItems;
    }
    public static List<Item> convertTransactionItemsToItems(List<TransactionItem> transactionItems) {
        List<Item> items = new ArrayList<>();
        for (TransactionItem transactionItem : transactionItems) {
            Item item;
            if (transactionItem instanceof TransactionEquip transactionEquip) {
                Equip equip = new Equip(transactionEquip.getItemId(), (short) transactionEquip.getPosition());
                equip.setUpgradeSlots(transactionEquip.getUpgradeSlots());
                equip.setLevel(transactionEquip.getLevel());
                equip.setStr(transactionEquip.getStr());
                equip.setDex(transactionEquip.getDex());
                equip.setInt(transactionEquip.getIntStat());
                equip.setLuk(transactionEquip.getLuk());
                equip.setHp(transactionEquip.getHp());
                equip.setMp(transactionEquip.getMp());
                equip.setWatk(transactionEquip.getWatk());
                equip.setMatk(transactionEquip.getMatk());
                equip.setWdef(transactionEquip.getWdef());
                equip.setMdef(transactionEquip.getMdef());
                equip.setAcc(transactionEquip.getAcc());
                equip.setAvoid(transactionEquip.getAvoid());
                equip.setHands(transactionEquip.getHands());
                equip.setSpeed(transactionEquip.getSpeed());
                equip.setJump(transactionEquip.getJump());
                equip.setVicious(transactionEquip.getVicious());
                equip.setTint(transactionEquip.getTintHue(), transactionEquip.getTintChroma(), transactionEquip.getTintBright());
                equip.setFxTint(transactionEquip.getTintFxHue(), transactionEquip.getTintFxChroma(), transactionEquip.getTintFxBright());
                equip.setItemLevel(transactionEquip.getItemLevel());
                equip.setItemExp(transactionEquip.getItemExp());
                equip.setRingId(transactionEquip.getRingId());
                item = equip;
            } else {
                item = new Item(transactionItem.getItemId(), (short) transactionItem.getPosition(), (short) transactionItem.getQuantity(), transactionItem.getPetId());
            }
            item.setOwner(transactionItem.getOwner());
            item.setExpiration(transactionItem.getExpiration());
            item.setGiftFrom(transactionItem.getGiftFrom());
            item.setFlag((short) transactionItem.getFlag());
            items.add(item);
        }
        return items;
    }

    public static List<Pair<Item, InventoryType>> convertTransactionItemsToItemPairs(List<TransactionItem> transactionItems) {
        List<Pair<Item, InventoryType>> itemPairs = new ArrayList<>();
        for (TransactionItem transactionItem : transactionItems) {
            Item item = getItemFromTransactionItem(transactionItem);
            InventoryType inventoryType = InventoryType.getByType((byte) transactionItem.getInventoryType());
            itemPairs.add(new Pair<>(item, inventoryType));
        }
        return itemPairs;
    }

    private static Item getItemFromTransactionItem(TransactionItem transactionItem) {
        Item item = new Item(transactionItem.getItemId(), (short) transactionItem.getPosition(), (short) transactionItem.getQuantity(), transactionItem.getPetId());
        item.setOwner(transactionItem.getOwner());
        item.setFlag((short) transactionItem.getFlag());
        item.setExpiration(transactionItem.getExpiration());
        item.setGiftFrom(transactionItem.getGiftFrom());
        return item;
    }

    // ======== DATABASE =========
    public static int createTransaction(int userId) throws SQLException {
        String insertTransactionSQL = "INSERT INTO transactions (user_id) VALUES (?)";
        try (Connection conn = DatabaseConnection.getConnection();
             PreparedStatement preparedStatement = conn.prepareStatement(insertTransactionSQL, PreparedStatement.RETURN_GENERATED_KEYS)) {
            preparedStatement.setInt(1, userId);
            preparedStatement.executeUpdate();

            try (ResultSet rs = preparedStatement.getGeneratedKeys()) {
                if (rs.next()) {
                    return rs.getInt(1);
                }
            }
        }
        return -1;
    }

    public static void createTransactionItems(int transactionId, List<TransactionItem> items) throws SQLException {
        String insertTransactionItemSQL = "INSERT INTO transaction_items (transaction_id, type, itemid, inventorytype, " +
                "position, quantity, owner, petid, flag, expiration, giftFrom) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
        String insertTransactionEquipSQL = "INSERT INTO transaction_equips (transaction_item_id, upgradeslots, level, str, dex, `int`, luk, hp, mp, watk, matk, wdef, mdef, acc, avoid, hands, speed, jump, vicious, tinthue, tintchroma, tintbright, tintfxhue, tintfxchroma, tintfxbright, itemlevel, itemexp, ringid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

        try (Connection conn = DatabaseConnection.getConnection();
             PreparedStatement itemPreparedStatement = conn.prepareStatement(insertTransactionItemSQL, Statement.RETURN_GENERATED_KEYS);
             PreparedStatement equipPreparedStatement = conn.prepareStatement(insertTransactionEquipSQL)) {

            for (TransactionItem item : items) {
                itemPreparedStatement.setInt(1, transactionId);
                itemPreparedStatement.setInt(2, item.getType());
                itemPreparedStatement.setInt(3, item.getItemId());
                itemPreparedStatement.setInt(4, item.getInventoryType());
                itemPreparedStatement.setInt(5, item.getPosition());
                itemPreparedStatement.setInt(6, item.getQuantity());
                itemPreparedStatement.setString(7, item.getOwner());
                itemPreparedStatement.setInt(8, item.getPetId());
                itemPreparedStatement.setInt(9, item.getFlag());
                itemPreparedStatement.setLong(10, item.getExpiration());
                itemPreparedStatement.setString(11, item.getGiftFrom());
                itemPreparedStatement.executeUpdate();

                try (ResultSet generatedKeys = itemPreparedStatement.getGeneratedKeys()) {
                    if (generatedKeys.next()) {
                        int transactionItemId = generatedKeys.getInt(1);

                        if (item instanceof TransactionEquip equip) {
                            equipPreparedStatement.setInt(1, transactionItemId);
                            equipPreparedStatement.setInt(2, equip.getUpgradeSlots());
                            equipPreparedStatement.setInt(3, equip.getLevel());
                            equipPreparedStatement.setInt(4, equip.getStr());
                            equipPreparedStatement.setInt(5, equip.getDex());
                            equipPreparedStatement.setInt(6, equip.getIntStat());
                            equipPreparedStatement.setInt(7, equip.getLuk());
                            equipPreparedStatement.setInt(8, equip.getHp());
                            equipPreparedStatement.setInt(9, equip.getMp());
                            equipPreparedStatement.setInt(10, equip.getWatk());
                            equipPreparedStatement.setInt(11, equip.getMatk());
                            equipPreparedStatement.setInt(12, equip.getWdef());
                            equipPreparedStatement.setInt(13, equip.getMdef());
                            equipPreparedStatement.setInt(14, equip.getAcc());
                            equipPreparedStatement.setInt(15, equip.getAvoid());
                            equipPreparedStatement.setInt(16, equip.getHands());
                            equipPreparedStatement.setInt(17, equip.getSpeed());
                            equipPreparedStatement.setInt(18, equip.getJump());
                            equipPreparedStatement.setInt(19, equip.getVicious());
                            equipPreparedStatement.setShort(20, equip.getTintHue());
                            equipPreparedStatement.setByte(21, equip.getTintChroma());
                            equipPreparedStatement.setByte(22, equip.getTintBright());
                            equipPreparedStatement.setShort(23, equip.getTintFxHue());
                            equipPreparedStatement.setByte(24, equip.getTintFxChroma());
                            equipPreparedStatement.setByte(25, equip.getTintFxBright());
                            equipPreparedStatement.setInt(26, equip.getItemLevel());
                            equipPreparedStatement.setInt(27, equip.getItemExp());
                            equipPreparedStatement.setInt(28, equip.getRingId());
                            equipPreparedStatement.addBatch();
                        }
                    }
                }
            }

            equipPreparedStatement.executeBatch();
        }
    }

    public static List<Transaction> getLastTransactions(int userId, int transactionCount) {
        List<Transaction> transactions = new ArrayList<>();
        if (transactionCount <= 0) {
            return transactions;
        }
        String selectTransactionsSQL = "SELECT * FROM transactions WHERE user_id = ? ORDER BY transaction_date DESC LIMIT ?";

        try (Connection conn = DatabaseConnection.getConnection();
             PreparedStatement transactionPreparedStatement = conn.prepareStatement(selectTransactionsSQL)) {

            transactionPreparedStatement.setInt(1, userId);
            transactionPreparedStatement.setInt(2, transactionCount);
            try (ResultSet rs = transactionPreparedStatement.executeQuery()) {
                while (rs.next()) {
                    Transaction transaction = new Transaction(
                            rs.getInt("transaction_id"),
                            rs.getInt("user_id"),
                            rs.getTimestamp("transaction_date").toInstant(),
                            rs.getBoolean("buyback_used"),
                            getTransactionItemsByTransactionId(rs.getInt("transaction_id")));
                    transactions.add(transaction);
                }
            }
        } catch (SQLException e) {
            // Honest failure: callers must surface an explicit error, never a
            // fake-empty history (that would wrongly report "no transactions").
            throw new IllegalStateException("Could not load transaction history for user " + userId, e);
        }

        return transactions;
    }

    public static Transaction getTransactionById(int transactionId) throws SQLException {
        Transaction transaction = null;
        String selectTransactionSQL = "SELECT * FROM transactions WHERE transaction_id = ?";
        String selectTransactionItemsSQL = "SELECT ti.*, te.upgradeslots, te.level, te.str, te.dex, te.`int`, te.luk, te.hp, te.mp, te.watk, te.matk, te.wdef, te.mdef, te.acc, te.avoid, te.hands, te.speed, te.jump, te.vicious, te.tinthue, te.tintchroma, te.tintbright, te.tintfxhue, te.tintfxchroma, te.tintfxbright, te.itemlevel, te.itemexp, te.ringid " +
                "FROM transaction_items ti " +
                "LEFT JOIN transaction_equips te ON ti.transaction_item_id = te.transaction_item_id " +
                "WHERE ti.transaction_id = ?";

        try (Connection conn = DatabaseConnection.getConnection();
             PreparedStatement transactionPreparedStatement = conn.prepareStatement(selectTransactionSQL);
             PreparedStatement itemPreparedStatement = conn.prepareStatement(selectTransactionItemsSQL)) {

            transactionPreparedStatement.setInt(1, transactionId);
            try (ResultSet rs = transactionPreparedStatement.executeQuery()) {
                if (rs.next()) {
                    transaction = new Transaction(
                            rs.getInt("transaction_id"),
                            rs.getInt("user_id"),
                            rs.getTimestamp("transaction_date").toInstant(),
                            rs.getBoolean("buyback_used"),
                            new ArrayList<>());
                }
            }

            if (transaction != null) {
                itemPreparedStatement.setInt(1, transactionId);
                try (ResultSet rs = itemPreparedStatement.executeQuery()) {
                    List<TransactionItem> items = new ArrayList<>();
                    readTransactionItems(rs, items);
                    transaction = new Transaction(transaction.transactionId(), transaction.userId(),
                            transaction.transactionDate(), transaction.buybackUsed(), items);
                }
            }
        }
        return transaction;
    }

    private static List<TransactionItem> getTransactionItemsByTransactionId(int transactionId) throws SQLException {
        List<TransactionItem> items = new ArrayList<>();
        String selectTransactionItemsSQL = "SELECT ti.*, te.upgradeslots, te.level, te.str, te.dex, te.`int`, te.luk, te.hp, te.mp, te.watk, te.matk, te.wdef, te.mdef, te.acc, te.avoid, te.hands, te.speed, te.jump, te.vicious, te.tinthue, te.tintchroma, te.tintbright, te.tintfxhue, te.tintfxchroma, te.tintfxbright, te.itemlevel, te.itemexp, te.ringid " +
                "FROM transaction_items ti " +
                "LEFT JOIN transaction_equips te ON ti.transaction_item_id = te.transaction_item_id " +
                "WHERE ti.transaction_id = ?";

        try (Connection conn = DatabaseConnection.getConnection();
             PreparedStatement preparedStatement = conn.prepareStatement(selectTransactionItemsSQL)) {

            preparedStatement.setInt(1, transactionId);
            try (ResultSet rs = preparedStatement.executeQuery()) {
                readTransactionItems(rs, items);
            }
        }
        return items;
    }

    private static void readTransactionItems(ResultSet rs, List<TransactionItem> items) throws SQLException {
        while (rs.next()) {
            InventoryType type = InventoryType.getByType(rs.getByte("ti.type"));
            TransactionItem item;

            if (type.equals(InventoryType.EQUIP)) {
                TransactionEquip equip = new TransactionEquip();
                equip.setUpgradeSlots(rs.getInt("te.upgradeslots"));
                equip.setLevel(rs.getByte("te.level"));
                equip.setStr(rs.getShort("te.str"));
                equip.setDex(rs.getShort("te.dex"));
                equip.setIntStat(rs.getShort("te.int"));
                equip.setLuk(rs.getShort("te.luk"));
                equip.setHp(rs.getShort("te.hp"));
                equip.setMp(rs.getShort("te.mp"));
                equip.setWatk(rs.getShort("te.watk"));
                equip.setMatk(rs.getShort("te.matk"));
                equip.setWdef(rs.getShort("te.wdef"));
                equip.setMdef(rs.getShort("te.mdef"));
                equip.setAcc(rs.getShort("te.acc"));
                equip.setAvoid(rs.getShort("te.avoid"));
                equip.setHands(rs.getShort("te.hands"));
                equip.setSpeed(rs.getShort("te.speed"));
                equip.setJump(rs.getShort("te.jump"));
                equip.setVicious(rs.getInt("te.vicious"));
                equip.setTintHue(rs.getShort("te.tinthue"));
                equip.setTintChroma(rs.getByte("te.tintchroma"));
                equip.setTintBright(rs.getByte("te.tintbright"));
                equip.setTintFxHue(rs.getShort("te.tintfxhue"));
                equip.setTintFxChroma(rs.getByte("te.tintfxchroma"));
                equip.setTintFxBright(rs.getByte("te.tintfxbright"));
                equip.setItemLevel(rs.getByte("te.itemlevel"));
                equip.setItemExp(rs.getInt("te.itemexp"));
                equip.setRingId(rs.getInt("te.ringid"));
                item = equip;
            } else {
                item = new TransactionItem();
            }

            item.setTransactionItemId(rs.getInt("ti.transaction_item_id"));
            item.setType(rs.getInt("ti.type"));
            item.setItemId(rs.getInt("ti.itemid"));
            item.setInventoryType(rs.getInt("ti.inventorytype"));
            item.setPosition(rs.getInt("ti.position"));
            item.setQuantity(rs.getInt("ti.quantity"));
            item.setOwner(rs.getString("ti.owner"));
            item.setPetId(rs.getInt("ti.petid"));
            item.setFlag(rs.getInt("ti.flag"));
            item.setExpiration(rs.getLong("ti.expiration"));
            item.setGiftFrom(rs.getString("ti.giftFrom"));
            items.add(item);
        }
    }

    /**
     * Status reset (unmark after an aborted pre-grant validation so the user can
     * retry). Intentionally unconditional — it is NOT a claim; the
     * first-claimer gate is {@link #claimTransactionBuyback(int)}. Only called
     * before any item is granted; never after a partial grant.
     */
    public static boolean updateTransactionBuybackStatus(int transactionId, boolean buybackUsed) {
        String updateTransactionSQL = "UPDATE transactions SET buyback_used = ? WHERE transaction_id = ?";
        try (Connection conn = DatabaseConnection.getConnection();
             PreparedStatement preparedStatement = conn.prepareStatement(updateTransactionSQL)) {
            preparedStatement.setBoolean(1, buybackUsed);
            preparedStatement.setInt(2, transactionId);
            int affectedRows = preparedStatement.executeUpdate();
            return affectedRows > 0;
        } catch (SQLException e) {
            return false;
        }
    }

    public static boolean deleteTransaction(int transactionId) throws SQLException {
        String deleteTransactionSQL = "DELETE FROM transactions WHERE transaction_id = ?";
        try (Connection conn = DatabaseConnection.getConnection();
             PreparedStatement preparedStatement = conn.prepareStatement(deleteTransactionSQL)) {
            preparedStatement.setInt(1, transactionId);
            int affectedRows = preparedStatement.executeUpdate();
            return affectedRows > 0;
        }
    }

    public static boolean deleteTransactionItems(List<Integer> transactionItemIds) throws SQLException {
        String deleteTransactionEquipSQL = "DELETE FROM transaction_equips WHERE transaction_item_id = ?";
        String deleteTransactionItemSQL = "DELETE FROM transaction_items WHERE transaction_item_id = ?";

        try (Connection conn = DatabaseConnection.getConnection();
             PreparedStatement equipPreparedStatement = conn.prepareStatement(deleteTransactionEquipSQL);
             PreparedStatement itemPreparedStatement = conn.prepareStatement(deleteTransactionItemSQL)) {

            for (int transactionItemId : transactionItemIds) {
                equipPreparedStatement.setInt(1, transactionItemId);
                equipPreparedStatement.addBatch();
            }
            equipPreparedStatement.executeBatch();

            for (int transactionItemId : transactionItemIds) {
                itemPreparedStatement.setInt(1, transactionItemId);
                itemPreparedStatement.addBatch();
            }
            int[] affectedRows = itemPreparedStatement.executeBatch();

            for (int count : affectedRows) {
                if (count == 0) {
                    return false;
                }
            }
            return true;
        }
    }
}
