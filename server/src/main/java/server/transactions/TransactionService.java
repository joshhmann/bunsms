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

/**
 * Buyback ledger over recorded sell events (MapleRoot wave 3 port).
 * Reads are honest: a ledger failure throws IllegalStateException (callers
 * surface an explicit error) instead of degrading to "no transactions".
 * The only early-out is MAXIMUM_TRANSACTIONS_FOR_BUYBACK <= 0 (disabled).
 */
public class TransactionService {

    private TransactionService() {
    }

    /** Immutable actual sale credit, never a quote from today's item data. */
    public static int getTotalPurchasePrice(Transaction transaction) {
        if (transaction.creditedMesos() == null) {
            throw new IllegalStateException("This historical sale has no recorded credit and cannot be bought back.");
        }
        return transaction.creditedMesos();
    }

    /** Existing NPC/casino pricing policy, evaluated only at the sale. */
    public static long getSalePrice(Item item) {
        if (CasinoChipConfig.isCasinoChip(item.getItemId())) {
            return (long) CasinoChipConfig.getChipPrice(item.getItemId()) * item.getQuantity();
        }
        ItemInformationProvider ii = ItemInformationProvider.getInstance();
        int price = ii.getWholePrice(item.getItemId());
        if (price < 0) {
            return -1;
        }
        if (!constants.inventory.ItemConstants.isRechargeable(item.getItemId())) {
            return (long) price * item.getQuantity();
        }
        return price + (long) Math.ceil(item.getQuantity() * ii.getUnitPrice(item.getItemId()));
    }

    public static boolean sameItem(Item live, Item expected, boolean compareQuantity) {
        if (live == null || expected == null || live.getClass() != expected.getClass()
                || live.getItemId() != expected.getItemId() || live.getPosition() != expected.getPosition()
                || (compareQuantity && live.getQuantity() != expected.getQuantity())
                || live.getPetId() != expected.getPetId() || live.getFlag() != expected.getFlag()
                || live.getSN() != expected.getSN()
                || live.getExpiration() != expected.getExpiration()
                || !live.getOwner().equals(expected.getOwner()) || !live.getGiftFrom().equals(expected.getGiftFrom())
                || live.getEffTintHue() != expected.getEffTintHue()
                || live.getEffTintChroma() != expected.getEffTintChroma()
                || live.getEffTintBright() != expected.getEffTintBright()) {
            return false;
        }
        if (live instanceof Equip a && expected instanceof Equip b) {
            return a.getUpgradeSlots() == b.getUpgradeSlots() && a.getLevel() == b.getLevel()
                    && a.getStr() == b.getStr() && a.getDex() == b.getDex() && a.getInt() == b.getInt()
                    && a.getLuk() == b.getLuk() && a.getHp() == b.getHp() && a.getMp() == b.getMp()
                    && a.getWatk() == b.getWatk() && a.getMatk() == b.getMatk()
                    && a.getWdef() == b.getWdef() && a.getMdef() == b.getMdef()
                    && a.getAcc() == b.getAcc() && a.getAvoid() == b.getAvoid() && a.getHands() == b.getHands()
                    && a.getSpeed() == b.getSpeed() && a.getJump() == b.getJump() && a.getVicious() == b.getVicious()
                    && a.getItemLevel() == b.getItemLevel() && a.getItemExp() == b.getItemExp()
                    && a.getRingId() == b.getRingId()
                    && a.getTintHue() == b.getTintHue() && a.getTintChroma() == b.getTintChroma()
                    && a.getTintBright() == b.getTintBright() && a.getTintFxHue() == b.getTintFxHue()
                    && a.getTintFxChroma() == b.getTintFxChroma() && a.getTintFxBright() == b.getTintFxBright();
        }
        return true;
    }

    /**
     * One sale, including its complete ledger and persisted inventory/balance.
     * The same character monitor serializes ordinary character saves.
     */
    public static int sellItems(Character player, InventoryType type, List<Item> soldItems, List<Item> originals) {
        if (type == null || type == InventoryType.UNDEFINED || type == InventoryType.EQUIPPED
                || type == InventoryType.CANHOLD || soldItems == null || soldItems.isEmpty()
                || originals == null || soldItems.size() != originals.size()) {
            return -1;
        }
        synchronized (player) {
            boolean ledgerEnabled = YamlConfig.config.server.MAXIMUM_TRANSACTIONS_FOR_BUYBACK > 0;
            List<client.inventory.Inventory> locked;
            if (ledgerEnabled) {
                locked = lockInventories(player);
            } else {
                client.inventory.Inventory inventory = player.getInventory(type);
                inventory.lockInventory();
                locked = java.util.Collections.singletonList(inventory);
            }
            player.lockMeso();
            try {
                java.util.Set<Short> slots = new java.util.HashSet<>();
                long nominalCredit = 0;
                for (int i = 0; i < soldItems.size(); i++) {
                    Item sold = soldItems.get(i);
                    if (sold == null || sold.getInventoryType() != type || sold.getPosition() < 1
                            || sold.getPosition() > player.getInventory(type).getSlotLimit()
                            || !slots.add(sold.getPosition())) {
                        return -1;
                    }
                    Item live = player.getInventory(type).getItem(sold.getPosition());
                    boolean rechargeable = constants.inventory.ItemConstants.isRechargeable(sold.getItemId());
                    if (live != originals.get(i) || !sameItem(live, sold, false) || sold.getQuantity() < 0
                            || (!rechargeable && sold.getQuantity() == 0)
                            || sold.getQuantity() > live.getQuantity()
                            || (rechargeable && sold.getQuantity() != live.getQuantity())) {
                        return -1;
                    }
                    long price = getSalePrice(sold);
                    if (price < 0) {
                        return -1;
                    }
                    nominalCredit = Math.addExact(nominalCredit, price);
                }
                int credit = (int) Math.min(nominalCredit, (long) Integer.MAX_VALUE - player.getMeso());
                InventorySnapshot before = snapshotInventoriesAndMesos(player, 1 << type.ordinal());
                if (!ledgerEnabled) {
                    try {
                        applySale(player, type, soldItems, credit);
                        return credit;
                    } catch (RuntimeException e) {
                        restoreInventoriesAndMesos(player, before);
                        return -1;
                    }
                }
                try (Connection connection = DatabaseConnection.getConnection()) {
                    connection.setAutoCommit(false);
                    try {
                        int transactionId = createTransaction(connection, player.getId(), credit);
                        createTransactionItems(connection, transactionId, convertItemsToTransactionItems(soldItems));
                        applySale(player, type, soldItems, credit);
                        persistInventoryAndMesos(connection, player);
                        connection.commit();
                        return credit;
                    } catch (SQLException | RuntimeException e) {
                        try {
                            connection.rollback();
                        } catch (SQLException rollbackFailure) {
                            e.addSuppressed(rollbackFailure);
                        }
                        restoreInventoriesAndMesos(player, before);
                        org.slf4j.LoggerFactory.getLogger(TransactionService.class).warn("Sale rolled back for character {}", player.getId(), e);
                        return -1;
                    }
                } catch (SQLException e) {
                    org.slf4j.LoggerFactory.getLogger(TransactionService.class).warn("Could not record sale for character {}", player.getId(), e);
                    return -1;
                }
            } finally {
                player.unlockMeso();
                unlockInventories(locked);
            }
        }
    }

    private static void applySale(Character player, InventoryType type, List<Item> items, int credit) {
        for (Item item : items) {
            InventoryManipulator.removeFromSlot(player.getClient(), type, item.getPosition(), item.getQuantity(), false);
        }
        if (credit > 0) {
            player.gainMeso(credit, false);
        }
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
        for (int i = 0; i < transactions.size(); i++) {
            Transaction transaction = transactions.get(i);
            String quote = transaction.creditedMesos() == null ? "unavailable: sale credit not recorded"
                    : GameConstants.numberWithCommas(transaction.creditedMesos()) + " mesos";
            stringBuilder.append("#L").append(transaction.transactionId()).append("#")
                    .append(i + 1).append(". ").append(transaction.items().size()).append(" items (")
                    .append(quote).append(")").append(transaction.buybackUsed() ? " [Used]" : "").append("#l\r\n");
        }

        return new SelectionListStringResult(true, stringBuilder.toString());
    }

    public static SelectionListStringResult getTransactionItemListString(int userId, int transactionId) {
        try (Connection connection = DatabaseConnection.getConnection()) {
            Transaction transaction = getTransactionById(connection, userId, transactionId, false);
            if (transaction == null) {
                return new SelectionListStringResult(false, "Invalid transaction.");
            }
            if (transaction.buybackUsed()) {
                return new SelectionListStringResult(false, "This transaction has already been bought back.");
            }
            if (transaction.creditedMesos() == null) {
                return new SelectionListStringResult(false, "This historical sale has no recorded credit and cannot be bought back.");
            }
            return getItemListString(transaction);
        } catch (SQLException e) {
            return new SelectionListStringResult(false, "Could not load transaction history. Please try again later.");
        }
    }

    private static SelectionListStringResult getItemListString(Transaction transaction) {
        StringBuilder text = new StringBuilder("Buy back this sale for ")
                .append(GameConstants.numberWithCommas(getTotalPurchasePrice(transaction)))
                .append(" mesos?\r\n\r\n");
        for (TransactionItem item : transaction.items()) {
            text.append("#i").append(item.getItemId()).append("# x").append(item.getQuantity()).append("\r\n");
        }
        return new SelectionListStringResult(true, text.toString());
    }

    public static SelectionListStringResult processTransaction(Character player, int transactionId) {
        if (YamlConfig.config.server.MAXIMUM_TRANSACTIONS_FOR_BUYBACK <= 0) {
            return new SelectionListStringResult(false, "Buyback is currently disabled.");
        }
        synchronized (player) {
            List<client.inventory.Inventory> locked = lockInventories(player);
            try {
                player.lockMeso();
                try (Connection conn = DatabaseConnection.getConnection()) {
                    conn.setAutoCommit(false);
                    InventorySnapshot snapshot = null;
                    boolean committed = false;
                    try {
                        Transaction transaction = getTransactionById(conn, player.getId(), transactionId, true);
                        if (transaction == null) {
                            return new SelectionListStringResult(false, "This transaction was not found.");
                        }
                        if (transaction.buybackUsed()) {
                            return new SelectionListStringResult(false, "This transaction has already been bought back.");
                        }
                        if (transaction.creditedMesos() == null || transaction.creditedMesos() < 0) {
                            return new SelectionListStringResult(false, "This historical transaction has no recorded sale quote and cannot be bought back.");
                        }
                        int buybackPrice = getTotalPurchasePrice(transaction);
                        if (player.getMeso() < buybackPrice) {
                            return new SelectionListStringResult(false, "You don't have enough mesos to complete this buyback.");
                        }
                        List<Item> items = convertTransactionItemsToItems(transaction.items());
                        if (!validRedemptionItems(transaction.items(), items) || !canGrantItems(player, items)) {
                            return new SelectionListStringResult(false, "These items cannot be received. Check inventory space and pickup restrictions.");
                        }

                        String claimSQL = "UPDATE transactions SET buyback_used = 1 WHERE transaction_id = ? AND user_id = ? AND buyback_used = 0";
                        try (PreparedStatement statement = conn.prepareStatement(claimSQL)) {
                            statement.setInt(1, transactionId);
                            statement.setInt(2, player.getId());
                            if (statement.executeUpdate() != 1) {
                                return new SelectionListStringResult(false, "This transaction has already been bought back.");
                            }
                        }
                        int affectedInventories = 0;
                        for (Item item : items) {
                            affectedInventories |= 1 << item.getInventoryType().ordinal();
                        }
                        snapshot = snapshotInventoriesAndMesos(player, affectedInventories);
                        java.util.BitSet occupied = new java.util.BitSet();
                        for (Item item : items) {
                            if (!grantRedemptionItem(player, item, occupied)) {
                                return new SelectionListStringResult(false, "The buyback was interrupted; no items or mesos were exchanged.");
                            }
                        }
                        player.gainMeso(-buybackPrice, true);
                        persistInventoryAndMesos(conn, player);
                        SelectionListStringResult result = new SelectionListStringResult(true,
                                "Bought back items for " + GameConstants.numberWithCommas(buybackPrice) + " mesos.");
                        conn.commit();
                        committed = true;
                        return result;
                    } finally {
                        if (!committed) {
                            try {
                                conn.rollback();
                            } finally {
                                if (snapshot != null) {
                                    restoreInventoriesAndMesos(player, snapshot);
                                }
                            }
                        }
                    }
                } catch (SQLException | RuntimeException e) {
                    org.slf4j.LoggerFactory.getLogger(TransactionService.class).error(
                            "Buyback {} failed for character {}", transactionId, player.getId(), e);
                    return new SelectionListStringResult(false,
                            "Could not complete or confirm the buyback. Reload transaction history before trying again.");
                } finally {
                    player.unlockMeso();
                }
            } finally {
                unlockInventories(locked);
            }
        }
    }

    static List<client.inventory.Inventory> lockInventories(Character player) {
        List<client.inventory.Inventory> locked = new ArrayList<>();
        try {
            for (InventoryType type : InventoryType.values()) {
                if (type == InventoryType.UNDEFINED || type == InventoryType.CANHOLD) {
                    continue;
                }
                client.inventory.Inventory inventory = player.getInventory(type);
                if (inventory != null) {
                    inventory.lockInventory();
                    locked.add(inventory);
                }
            }
            return locked;
        } catch (RuntimeException e) {
            unlockInventories(locked);
            throw e;
        }
    }

    static void unlockInventories(List<client.inventory.Inventory> locked) {
        for (int i = locked.size() - 1; i >= 0; i--) {
            locked.get(i).unlockInventory();
        }
    }

    static final class InventorySnapshot {
        private final java.util.Map<InventoryType, java.util.Map<Short, SlotSnapshot>> inventories =
                new java.util.EnumMap<>(InventoryType.class);
        private final int mesos;

        private InventorySnapshot(int mesos) {
            this.mesos = mesos;
        }
    }

    private static final class SlotSnapshot {
        private final Item original;
        private final short position;
        private final short quantity;

        private SlotSnapshot(Item item) {
            original = item;
            position = item.getPosition();
            quantity = item.getQuantity();
        }
    }

    // Callers hold the character monitor, affected inventory locks, then meso
    // lock. Retain original objects: sale/grant mutates only slot membership,
    // position and quantity, while Item.copy omits pet/cash identity.
    static InventorySnapshot snapshotInventoriesAndMesos(Character player, int affectedInventories) {
        InventorySnapshot snapshot = new InventorySnapshot(player.getMeso());
        for (InventoryType type : InventoryType.values()) {
            if ((affectedInventories & (1 << type.ordinal())) == 0) {
                continue;
            }
            client.inventory.Inventory inventory = player.getInventory(type);
            if (inventory == null) {
                continue;
            }
            java.util.Map<Short, SlotSnapshot> slots = new java.util.LinkedHashMap<>();
            for (Item item : inventory.list()) {
                slots.put(item.getPosition(), new SlotSnapshot(item));
            }
            snapshot.inventories.put(type, slots);
        }
        return snapshot;
    }

    static void restoreInventoriesAndMesos(Character player, InventorySnapshot snapshot) {
        List<Pair<Integer, Item>> corrections = new ArrayList<>();
        for (var entry : snapshot.inventories.entrySet()) {
            client.inventory.Inventory inventory = player.getInventory(entry.getKey());
            java.util.Map<Short, SlotSnapshot> slots = entry.getValue();
            for (Item item : new ArrayList<>(inventory.list())) {
                SlotSnapshot saved = slots.get(item.getPosition());
                if (saved == null || saved.original != item) {
                    Item removed = new Item(item.getItemId(), item.getPosition(), item.getQuantity());
                    inventory.removeSlot(item.getPosition());
                    corrections.add(new Pair<>(3, removed));
                }
            }
            for (SlotSnapshot saved : slots.values()) {
                boolean present = inventory.getItem(saved.position) == saved.original;
                boolean changed = saved.original.getQuantity() != saved.quantity
                        || saved.original.getPosition() != saved.position;
                saved.original.setPosition(saved.position);
                saved.original.setQuantity(saved.quantity);
                if (!present) {
                    inventory.addItemFromDB(saved.original);
                    corrections.add(new Pair<>(0, saved.original));
                } else if (changed) {
                    corrections.add(new Pair<>(1, saved.original));
                }
            }
        }
        // Restore all server slots before any correction packet can fail.
        RuntimeException packetFailure = null;
        try {
            player.gainMeso(snapshot.mesos - player.getMeso(), false);
        } catch (RuntimeException e) {
            packetFailure = e;
        }
        for (Pair<Integer, Item> correction : corrections) {
            try {
                player.sendPacket(tools.PacketCreator.modifyInventory(true,
                        java.util.Collections.singletonList(inventoryCorrection(correction.getLeft(), correction.getRight()))));
            } catch (RuntimeException e) {
                if (packetFailure == null) {
                    packetFailure = e;
                } else {
                    packetFailure.addSuppressed(e);
                }
            }
        }
        if (packetFailure != null) {
            throw packetFailure;
        }
    }

    static void persistInventoryAndMesos(Connection conn, Character player) throws SQLException {
        List<Pair<Item, InventoryType>> items = new ArrayList<>();
        for (InventoryType type : InventoryType.values()) {
            if (type == InventoryType.UNDEFINED || type == InventoryType.CANHOLD) {
                continue;
            }
            client.inventory.Inventory inventory = player.getInventory(type);
            if (inventory != null) {
                for (Item item : inventory.list()) {
                    items.add(new Pair<>(item, type));
                }
            }
        }
        client.inventory.ItemFactory.INVENTORY.saveItems(items, player.getId(), conn);
        try (PreparedStatement statement = conn.prepareStatement("UPDATE characters SET meso = ? WHERE id = ?")) {
            statement.setInt(1, player.getMeso());
            statement.setInt(2, player.getId());
            if (statement.executeUpdate() != 1) {
                throw new SQLException("Character meso persistence did not update exactly one row");
            }
        }
    }

    private static boolean validRedemptionItems(List<TransactionItem> recorded, List<Item> items) {
        if (items.isEmpty() || recorded.size() != items.size()) {
            return false;
        }
        for (int i = 0; i < items.size(); i++) {
            Item item = items.get(i);
            TransactionItem source = recorded.get(i);
            InventoryType type = item.getInventoryType();
            boolean rechargeable = constants.inventory.ItemConstants.isRechargeable(item.getItemId());
            if (type == InventoryType.UNDEFINED || type == InventoryType.CANHOLD || type == InventoryType.EQUIPPED
                    || type.getType() != source.getInventoryType() || source.getQuantity() > Short.MAX_VALUE
                    || source.getQuantity() < 0 || (!rechargeable && source.getQuantity() == 0)
                    || item.getPetId() != source.getPetId() || item.getOwner() == null
                    || (type == InventoryType.EQUIP && (!(item instanceof Equip) || source.getQuantity() != 1))) {
                return false;
            }
        }
        return true;
    }

    private static final class GrantStack {
        private final int itemId;
        private final String owner;
        private final short flag;
        private int quantity;

        private GrantStack(Item item, int quantity) {
            itemId = item.getItemId();
            owner = item.getOwner();
            flag = item.getFlag();
            this.quantity = quantity;
        }
    }

    // Simulate the whole grant sequence without touching live items. Unlike
    // generic checkSpots, addFromDrop stacks only equal owner AND equal flag,
    // never merges rechargeables/pets, and checks equipped pickup restrictions.
    private static boolean canGrantItems(Character player, List<Item> items) {
        java.util.Map<InventoryType, List<GrantStack>> stacks = new java.util.EnumMap<>(InventoryType.class);
        java.util.Map<InventoryType, Integer> freeSlots = new java.util.EnumMap<>(InventoryType.class);
        int affectedInventories = 0;
        ItemInformationProvider ii = ItemInformationProvider.getInstance();
        for (Item item : items) {
            affectedInventories |= 1 << item.getInventoryType().ordinal();
            if (ii.isPickupRestricted(item.getItemId())) {
                affectedInventories |= 1 << InventoryType.EQUIPPED.ordinal();
            }
        }
        for (InventoryType type : InventoryType.values()) {
            if ((affectedInventories & (1 << type.ordinal())) == 0) {
                continue;
            }
            client.inventory.Inventory inventory = player.getInventory(type);
            if (inventory == null) {
                continue;
            }
            List<GrantStack> contents = new ArrayList<>();
            for (Item item : inventory.list()) {
                contents.add(new GrantStack(item, item.getQuantity()));
            }
            stacks.put(type, contents);
            freeSlots.put(type, Math.min(inventory.getNumFreeSlot(),
                    Math.max(0, inventory.getSlotLimit() - contents.size())));
        }
        for (Item item : items) {
            InventoryType type = item.getInventoryType();
            List<GrantStack> contents = stacks.get(type);
            if (contents == null) {
                return false;
            }
            if (ii.isPickupRestricted(item.getItemId())) {
                for (GrantStack existing : contents) {
                    if (existing.itemId == item.getItemId()) {
                        return false;
                    }
                }
                for (GrantStack equipped : stacks.getOrDefault(InventoryType.EQUIPPED, java.util.Collections.emptyList())) {
                    if (equipped.itemId == item.getItemId()) {
                        return false;
                    }
                }
            }
            int remaining = item.getQuantity();
            if (type == InventoryType.EQUIP || constants.inventory.ItemConstants.isRechargeable(item.getItemId())
                    || item.getPetId() != -1) {
                if (freeSlots.get(type) == 0) {
                    return false;
                }
                freeSlots.put(type, freeSlots.get(type) - 1);
                contents.add(new GrantStack(item, remaining));
                continue;
            }
            int slotMax = ii.getSlotMax(player.getClient(), item.getItemId());
            if (slotMax <= 0) {
                return false;
            }
            for (GrantStack existing : contents) {
                if (existing.itemId == item.getItemId() && existing.flag == item.getFlag()
                        && item.getOwner().equals(existing.owner) && existing.quantity < slotMax) {
                    int added = Math.min(remaining, slotMax - existing.quantity);
                    existing.quantity += added;
                    remaining -= added;
                    if (remaining == 0) {
                        break;
                    }
                }
            }
            while (remaining > 0) {
                if (freeSlots.get(type) == 0) {
                    return false;
                }
                int added = Math.min(remaining, slotMax);
                contents.add(new GrantStack(item, added));
                freeSlots.put(type, freeSlots.get(type) - 1);
                remaining -= added;
            }
        }
        return true;
    }

    private static boolean grantRedemptionItem(Character player, Item item, java.util.BitSet occupied) {
        client.inventory.Inventory inventory = player.getInventory(item.getInventoryType());
        occupied.clear();
        for (Item existing : inventory.list()) {
            occupied.set(existing.getPosition());
        }
        if (!InventoryManipulator.addFromDrop(player.getClient(), item, false)) {
            return false;
        }
        for (Item granted : inventory.list()) {
            if (!occupied.get(granted.getPosition()) && granted != item) {
                boolean changed = !item.getOwner().equals(granted.getOwner())
                        || !java.util.Objects.equals(item.getGiftFrom(), granted.getGiftFrom())
                        || item.getSN() != granted.getSN()
                        || item.getEffTintHue() != granted.getEffTintHue()
                        || item.getEffTintChroma() != granted.getEffTintChroma()
                        || item.getEffTintBright() != granted.getEffTintBright();
                granted.setOwner(item.getOwner());
                granted.setGiftFrom(item.getGiftFrom());
                granted.setSN(item.getSN());
                granted.setEffTint(item.getEffTintHue(), item.getEffTintChroma(), item.getEffTintBright());
                if (changed) {
                    player.sendPacket(tools.PacketCreator.modifyInventory(true, java.util.List.of(
                            inventoryCorrection(3, granted), inventoryCorrection(0, granted))));
                }
            }
        }
        return true;
    }

    private static client.inventory.ModifyInventory inventoryCorrection(int mode, Item item) {
        client.inventory.ModifyInventory correction = new client.inventory.ModifyInventory(mode, item);
        Item copied = correction.getItem();
        copied.setGiftFrom(item.getGiftFrom());
        copied.setSN(item.getSN());
        if (copied instanceof Equip equip && item instanceof Equip original) {
            equip.setRingId(original.getRingId());
        }
        return correction;
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
            transactionItem.setSN(item.getSN());
            transactionItem.setEffTintHue(item.getEffTintHue());
            transactionItem.setEffTintChroma(item.getEffTintChroma());
            transactionItem.setEffTintBright(item.getEffTintBright());
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
            item.setSN(transactionItem.getSN());
            item.setEffTint(transactionItem.getEffTintHue(), transactionItem.getEffTintChroma(), transactionItem.getEffTintBright());
            items.add(item);
        }
        return items;
    }


    // ======== DATABASE =========
    private static int createTransaction(Connection conn, int userId, int creditedMesos) throws SQLException {
        String insertTransactionSQL = "INSERT INTO transactions (user_id, credited_mesos) VALUES (?, ?)";
        try (PreparedStatement preparedStatement = conn.prepareStatement(insertTransactionSQL, Statement.RETURN_GENERATED_KEYS)) {
            preparedStatement.setInt(1, userId);
            preparedStatement.setInt(2, creditedMesos);
            preparedStatement.executeUpdate();
            try (ResultSet rs = preparedStatement.getGeneratedKeys()) {
                if (rs.next()) {
                    return rs.getInt(1);
                }
            }
        }
        throw new SQLException("Sale ledger insert returned no transaction id");
    }

    private static void createTransactionItems(Connection conn, int transactionId, List<TransactionItem> items) throws SQLException {
        String insertTransactionItemSQL = "INSERT INTO transaction_items (transaction_id, type, itemid, inventorytype, " +
                "position, quantity, owner, petid, flag, expiration, giftFrom, sn, efftinthue, efftintchroma, efftintbright) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
        String insertTransactionEquipSQL = "INSERT INTO transaction_equips (transaction_item_id, upgradeslots, level, str, dex, `int`, luk, hp, mp, watk, matk, wdef, mdef, acc, avoid, hands, speed, jump, vicious, tinthue, tintchroma, tintbright, tintfxhue, tintfxchroma, tintfxbright, itemlevel, itemexp, ringid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

        try (PreparedStatement itemPreparedStatement = conn.prepareStatement(insertTransactionItemSQL, Statement.RETURN_GENERATED_KEYS);
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
                itemPreparedStatement.setInt(12, item.getSN());
                itemPreparedStatement.setShort(13, item.getEffTintHue());
                itemPreparedStatement.setByte(14, item.getEffTintChroma());
                itemPreparedStatement.setByte(15, item.getEffTintBright());
                itemPreparedStatement.executeUpdate();

                try (ResultSet generatedKeys = itemPreparedStatement.getGeneratedKeys()) {
                    if (!generatedKeys.next()) {
                        throw new SQLException("Sale item insert returned no item id");
                    }
                    {
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
        String selectTransactionsSQL = "SELECT * FROM transactions WHERE user_id = ? ORDER BY transaction_date DESC, transaction_id DESC LIMIT ?";

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
                            (Integer) rs.getObject("credited_mesos"),
                            getTransactionItemsByTransactionId(conn, rs.getInt("transaction_id")));
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

    static Transaction getTransactionById(Connection conn, int userId, int transactionId, boolean forUpdate) throws SQLException {
        String sql = "SELECT * FROM transactions WHERE transaction_id = ? AND user_id = ?" + (forUpdate ? " FOR UPDATE" : "");
        try (PreparedStatement statement = conn.prepareStatement(sql)) {
            statement.setInt(1, transactionId);
            statement.setInt(2, userId);
            try (ResultSet rs = statement.executeQuery()) {
                if (!rs.next()) {
                    return null;
                }
                return new Transaction(rs.getInt("transaction_id"), rs.getInt("user_id"),
                        rs.getTimestamp("transaction_date").toInstant(), rs.getBoolean("buyback_used"),
                        (Integer) rs.getObject("credited_mesos"), getTransactionItemsByTransactionId(conn, transactionId));
            }
        }
    }

    private static List<TransactionItem> getTransactionItemsByTransactionId(Connection conn, int transactionId) throws SQLException {
        List<TransactionItem> items = new ArrayList<>();
        String selectTransactionItemsSQL = "SELECT ti.*, te.transaction_item_id AS equip_snapshot_id, te.upgradeslots, te.level, te.str, te.dex, te.`int`, te.luk, te.hp, te.mp, te.watk, te.matk, te.wdef, te.mdef, te.acc, te.avoid, te.hands, te.speed, te.jump, te.vicious, te.tinthue, te.tintchroma, te.tintbright, te.tintfxhue, te.tintfxchroma, te.tintfxbright, te.itemlevel, te.itemexp, te.ringid " +
                "FROM transaction_items ti " +
                "LEFT JOIN transaction_equips te ON ti.transaction_item_id = te.transaction_item_id " +
                "WHERE ti.transaction_id = ?";

        try (PreparedStatement preparedStatement = conn.prepareStatement(selectTransactionItemsSQL)) {

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
                if (rs.getObject("equip_snapshot_id") == null) {
                    throw new SQLException("Sale ledger contains an incomplete equipment snapshot");
                }
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
            item.setSN(rs.getInt("ti.sn"));
            item.setEffTintHue(rs.getShort("ti.efftinthue"));
            item.setEffTintChroma(rs.getByte("ti.efftintchroma"));
            item.setEffTintBright(rs.getByte("ti.efftintbright"));
            items.add(item);
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
