package net.server.channel.handlers;

import client.Character;
import client.Client;
import client.inventory.InventoryType;
import client.inventory.Item;
import constants.id.ItemId;
import net.AbstractPacketHandler;
import net.packet.InPacket;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import server.maps.FieldLimit;
import server.maps.MapleMap;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/*
 * Hyper Teleport Rock (item 5590001) — MapleRoot port.
 *
 * Warp targets come from the packet; genuine Item/String assets for5590001 are
 * required. The rock lives in CASH inventory and its 5-minute cooldown
 * is enforced server-side in process memory.
 *
 * Wire (client -> server, RecvOpcode.USE_HYPERROCK = 0xF1, same value as the source):
 *   int targetMapId
 *
 * Deviations from the source, all deliberate:
 * - The source only checked the cooldown when the player did NOT hold the rock, so
 *   holders teleported with no cooldown at all and non-holders got free timed warps.
 *   Here the rock is REQUIRED and the cooldown applies to everyone holding it.
 * - The source gated Lion King / Twilight Perion / Grandis-Arcane maps behind
 *   Character.getReborns(), which does not exist in our tree (no rebirth system).
 *   Those gates are omitted; CANNOTVIPROCK field limits plus the restricted-map
 *   list below remain the blocklist.
 * - lastTeleportTime is a ConcurrentHashMap (the source used a plain HashMap while
 *   channel packet threads can race on it).
 * - Guards added beyond the source: short-packet guard (packet carries an int),
 *   source-map CANNOTVIPROCK check (leaving matches arriving), event-instance
 *   refusal (leaving mid-event breaks DKBONUS/YOSHI/Castellan), and an
 *   in-flight per-player guard against double-submitted packets.
 */
public final class HyperTPHandler extends AbstractPacketHandler {

    private static final Logger log = LoggerFactory.getLogger(HyperTPHandler.class);

    private static final long COOLDOWN_MILLIS = 5 * 60 * 1000L; // 5 minutes

    // Player id -> last successful warp millis. Static so every channel handler
    // instance shares one server-side cooldown (mirrors the source).
    private static final Map<Integer, Long> lastTeleportTime = new ConcurrentHashMap<>();

    // Player id -> in-flight warp marker. A second packet arriving while the
    // first is still being processed is refused with a cooldown-style message.
    private static final Map<Integer, Boolean> inFlightWarps = new ConcurrentHashMap<>();

    @Override
    public final void handlePacket(InPacket p, Client c) {
        if (p.available() < 4) {
            return;
        }
        Character player = c.getPlayer();
        if (player == null) {
            return;
        }
        if (inFlightWarps.putIfAbsent(player.getId(), Boolean.TRUE) != null) {
            player.dropMessage(1, "You need to wait a moment before teleporting again.");
            return;
        }
        try {
            handleWarp(p, player, c);
        } finally {
            inFlightWarps.remove(player.getId());
        }
    }

    private void handleWarp(InPacket p, Character player, Client c) {
        int mapId = p.readInt();

        if (!hasRequiredItem(player)) {
            player.dropMessage(1, "You need a Hyper Teleport Rock to warp. Item 5590001 is required.");
            return;
        }

        long now = System.currentTimeMillis();
        long elapsed = now - lastTeleportTime.getOrDefault(player.getId(), 0L);
        if (elapsed < COOLDOWN_MILLIS) {
            long waitSecs = (COOLDOWN_MILLIS - elapsed) / 1000;
            player.dropMessage(1, "You need to wait " + waitSecs + " seconds before teleporting again.");
            return;
        }

        MapleMap target;
        try {
            target = c.getChannelServer().getMapFactory().getMap(mapId);
        } catch (Exception e) {
            player.yellowMessage("Map is invalid.");
            return;
        }
        if (target == null) {
            player.yellowMessage("Map is invalid.");
            return;
        }

        if (isRestrictedMap(mapId)) {
            player.dropMessage(1, "You are not allowed to teleport to this map.");
            return;
        }
        if (FieldLimit.CANNOTVIPROCK.check(player.getMap().getFieldLimit())) {
            player.dropMessage(1, "Unable to approach due to the force of the ground.");
            return;
        }

        if (player.getEventInstance() != null) {
            player.dropMessage(1, "You cannot teleport while inside an event instance.");
            return;
        }

        if (FieldLimit.CANNOTVIPROCK.check(target.getFieldLimit())) {
            player.dropMessage(1, "Unable to approach due to the force of the ground.");
            return;
        }

        try {
            player.saveLocationOnWarp();
            player.changeMap(target, target.getRandomPlayerSpawnpoint());

            // Only stamp the cooldown after a successful warp.
            lastTeleportTime.put(player.getId(), System.currentTimeMillis());
            log.info("[HyperTP] {} warped to {}", player.getName(), mapId);
        } catch (Exception e) {
            log.warn("[HyperTP] {} failed to warp to {}", player.getName(), mapId, e);
            player.yellowMessage("Map is invalid.");
        }
    }

    private boolean hasRequiredItem(Character player) {
        Item item = player.getInventory(InventoryType.CASH).findById(ItemId.HYPER_TELEPORT_ROCK);
        return item != null;
    }

    public static boolean isRestrictedMap(int mapId) {
        return mapId == 401053002 || (mapId >= 271030000 && mapId <= 271040300);
    }
}
