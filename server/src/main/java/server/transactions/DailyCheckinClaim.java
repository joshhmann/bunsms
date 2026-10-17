package server.transactions;

import client.Character;
import client.Client;
import client.inventory.Inventory;
import client.inventory.InventoryType;
import client.inventory.manipulator.InventoryManipulator;
import constants.inventory.ItemConstants;
import tools.DatabaseConnection;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import server.DailyCheckinRewards;
import tools.PacketCreator;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;

/** One promised daily reward and its claim marker share the existing inventory/JDBC boundary. */
public final class DailyCheckinClaim {
    private static final Logger log = LoggerFactory.getLogger(DailyCheckinClaim.class);
    private static final long DAY_MILLIS = 86_400_000L;

    private DailyCheckinClaim() {}

    public static boolean claim(Client client, int day, DailyCheckinRewards.Reward reward) {
        Character player = client.getPlayer();
        synchronized (player) {
            List<Inventory> locked = TransactionService.lockInventories(player);
            boolean mesoLocked = false;
            try {
                player.lockMeso();
                mesoLocked = true;
                if (day < 1 || day > DailyCheckinRewards.CYCLE_DAYS
                        || player.getLevel() < DailyCheckinRewards.MIN_LEVEL || player.refreshCheckin() != day) {
                    return false;
                }
                if (reward.mesos() < 0 || reward.mesos() > (long) Integer.MAX_VALUE - player.getMeso()) {
                    player.dropMessage(1, "Make room in your meso wallet before claiming the full daily reward.");
                    return false;
                }
                int affected = 0;
                for (var grant : reward.grants()) {
                    InventoryType type = ItemConstants.getInventoryType(grant.itemId());
                    if (grant.qty() <= 0 || grant.qty() > Short.MAX_VALUE || grant.expireDays() < 0
                            || type == InventoryType.UNDEFINED || type == InventoryType.CANHOLD) {
                        throw new IllegalStateException("Invalid daily reward item definition");
                    }
                    affected |= 1 << type.ordinal();
                }
                Inventory expanded = null;
                int oldLimit = 0;
                if (reward.slotType() > 0 || reward.slotCount() > 0) {
                    // The character schema persists these four inventory capacities. Cash is fixed96.
                    if (reward.slotType() < 1 || reward.slotType() > 4 || reward.slotCount() <= 0
                            || !player.canGainSlots(reward.slotType(), reward.slotCount())) {
                        player.dropMessage(1, "The full daily inventory expansion cannot be received.");
                        return false;
                    }
                    expanded = player.getInventory(InventoryType.getByType((byte) reward.slotType()));
                    oldLimit = expanded.getSlotLimit();
                }
                long previousClaim = player.getCheckinLastClaim();
                try (Connection connection = DatabaseConnection.getConnection()) {
                    connection.setAutoCommit(false);
                    TransactionService.InventorySnapshot snapshot = null;
                    boolean committed = false;
                    try {
                        try (PreparedStatement query = connection.prepareStatement(
                                "SELECT checkinLastClaim FROM characters WHERE id = ? FOR UPDATE")) {
                            query.setInt(1, player.getId());
                            try (ResultSet row = query.executeQuery()) {
                                if (!row.next() || row.getLong(1) != previousClaim) {
                                    player.dropMessage(1, "Your daily claim state changed. Relog before claiming again.");
                                    return false;
                                }
                            }
                        }
                        snapshot = TransactionService.snapshotInventoriesAndMesos(player, affected);
                        if (expanded != null) {
                            expanded.setSlotLimit(oldLimit + reward.slotCount());
                            client.sendPacket(PacketCreator.updateInventorySlotLimit(reward.slotType(), expanded.getSlotLimit()));
                        }
                        for (var grant : reward.grants()) {
                            long expiration = grant.expireDays() > 0
                                    ? Math.addExact(System.currentTimeMillis(), Math.multiplyExact((long) grant.expireDays(), DAY_MILLIS)) : -1;
                            if (!InventoryManipulator.addById(client, grant.itemId(), (short) grant.qty(), expiration)) {
                                player.dropMessage(1, "Make room for every daily reward item before claiming.");
                                return false;
                            }
                        }
                        if (reward.mesos() > 0) player.gainMeso(reward.mesos(), true);
                        TransactionService.persistInventoryAndMesos(connection, player);
                        long claimedAt = System.currentTimeMillis();
                        int claimed = player.getCheckinClaimed() | (1 << (day - 1));
                        try (PreparedStatement update = connection.prepareStatement(
                                "UPDATE characters SET checkinDay = ?, checkinClaimed = ?, checkinLastClaim = ?, "
                                        + "equipslots = ?, useslots = ?, setupslots = ?, etcslots = ? WHERE id = ?")) {
                            update.setInt(1, day);
                            update.setInt(2, claimed);
                            update.setLong(3, claimedAt);
                            update.setInt(4, player.getInventory(InventoryType.EQUIP).getSlotLimit());
                            update.setInt(5, player.getInventory(InventoryType.USE).getSlotLimit());
                            update.setInt(6, player.getInventory(InventoryType.SETUP).getSlotLimit());
                            update.setInt(7, player.getInventory(InventoryType.ETC).getSlotLimit());
                            update.setInt(8, player.getId());
                            if (update.executeUpdate() != 1) throw new SQLException("Daily claim did not update exactly one character");
                        }
                        connection.commit();
                        committed = true;
                        player.applyCheckinClaim(day, claimedAt);
                        return true;
                    } finally {
                        if (!committed) {
                            try {
                                connection.rollback();
                            } finally {
                                boolean resetSlots = expanded != null && expanded.getSlotLimit() != oldLimit;
                                if (resetSlots) expanded.setSlotLimit(oldLimit);
                                RuntimeException packetFailure = null;
                                try {
                                    if (snapshot != null) TransactionService.restoreInventoriesAndMesos(player, snapshot);
                                } catch (RuntimeException failure) {
                                    packetFailure = failure;
                                }
                                if (resetSlots) {
                                    try {
                                        client.sendPacket(PacketCreator.updateInventorySlotLimit(reward.slotType(), oldLimit));
                                    } catch (RuntimeException failure) {
                                        if (packetFailure == null) packetFailure = failure;
                                        else packetFailure.addSuppressed(failure);
                                    }
                                }
                                if (packetFailure != null) throw packetFailure;
                            }
                        }
                    }
                } catch (SQLException | RuntimeException failure) {
                    log.warn("Daily reward/claim failed for character {} day {}", player.getId(), day, failure);
                    player.dropMessage(1, "The daily claim could not be completed or confirmed. Relog before trying again.");
                    return false;
                }
            } finally {
                if (mesoLocked) player.unlockMeso();
                TransactionService.unlockInventories(locked);
            }
        }
    }
}
