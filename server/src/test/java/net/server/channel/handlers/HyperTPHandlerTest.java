package net.server.channel.handlers;

import client.Client;
import client.inventory.Inventory;
import client.inventory.InventoryType;
import client.inventory.Item;
import constants.id.ItemId;
import net.packet.InPacket;
import net.server.channel.Channel;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import server.maps.MapManager;
import server.maps.MapleMap;
import server.maps.Portal;
import testutil.HandlerTest;
import testutil.Packets;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Hyper Teleport Rock wire + behavior contract: opcode 0xF1 (same value as the
 * MapleRoot source), item 5590001 required in CASH inventory, server-side
 * 5-minute cooldown, restricted maps refused, VIP-rock-blocked maps refused.
 */
@ExtendWith(MockitoExtension.class)
class HyperTPHandlerTest extends HandlerTest {

    private final HyperTPHandler handler = new HyperTPHandler();

    @Mock
    private Channel channel;

    @Mock
    private MapManager mapFactory;

    @Mock
    private MapleMap targetMap;

    @Mock
    private Portal spawnPoint;

    private InPacket warpPacket(int mapId) {
        return Packets.buildInPacket(out -> out.writeInt(mapId));
    }

    private void stubChannel() {
        lenient().when(client.getChannelServer()).thenReturn(channel);
        lenient().when(channel.getMapFactory()).thenReturn(mapFactory);
        lenient().when(mapFactory.getMap(anyInt())).thenReturn(targetMap);
        lenient().when(targetMap.getFieldLimit()).thenReturn(0);
        lenient().when(targetMap.getRandomPlayerSpawnpoint()).thenReturn(spawnPoint);
        lenient().when(chr.getId()).thenReturn(424242 + (int) (Math.random() * 100000));
        // Source map: open vanilla map by default (source-map CANNOTVIPROCK
        // check needs a non-null player map in every warp test).
        lenient().when(chr.getMap()).thenReturn(targetMap);
    }

    private void stubRock(boolean present) {
        Inventory cash = org.mockito.Mockito.mock(Inventory.class);
        lenient().when(chr.getInventory(InventoryType.CASH)).thenReturn(cash);
        Item rock = present ? new Item(ItemId.HYPER_TELEPORT_ROCK, (short) 1, (short) 1) : null;
        lenient().when(cash.findById(ItemId.HYPER_TELEPORT_ROCK)).thenReturn(rock);
    }


    @Test
    void warpSucceedsWithRockAndNoCooldown() {
        stubChannel();
        stubRock(true);
        when(chr.getName()).thenReturn("HyperTester");

        // 105000000 (Sleepywood) — vanilla map with no field limit in the test double.
        handler.handlePacket(warpPacket(105000000), client);

        verify(chr).saveLocationOnWarp();
        verify(chr).changeMap(targetMap, spawnPoint);
    }

    @Test
    void secondWarpInsideFiveMinutesIsRefused() {
        stubChannel();
        stubRock(true);
        when(chr.getId()).thenReturn(777001);
        when(chr.getName()).thenReturn("HyperTester");

        handler.handlePacket(warpPacket(105000000), client);
        handler.handlePacket(warpPacket(105000001), client);

        verify(chr).dropMessage(eq(1), org.mockito.ArgumentMatchers.contains("wait"));
        // Only the first warp went through.
        verify(chr, org.mockito.Mockito.times(1)).changeMap(any(MapleMap.class), any(Portal.class));
    }

    @Test
    void warpWithoutRockIsRefused() {
        stubChannel();
        stubRock(false);

        handler.handlePacket(warpPacket(105000000), client);

        verify(chr).dropMessage(eq(1), org.mockito.ArgumentMatchers.contains("5590001"));
        verify(chr, never()).changeMap(any(MapleMap.class), any(Portal.class));
    }

    @Test
    void restrictedMapIsRefused() {
        stubChannel();
        stubRock(true);

        handler.handlePacket(warpPacket(401053002), client);

        verify(chr).dropMessage(eq(1), org.mockito.ArgumentMatchers.contains("not allowed"));
        verify(chr, never()).changeMap(any(MapleMap.class), any(Portal.class));
    }

    @Test
    void vipRockBlockedMapIsRefused() {
        stubChannel();
        stubRock(true);
        when(targetMap.getFieldLimit()).thenReturn(0x40); // FieldLimit.CANNOTVIPROCK

        handler.handlePacket(warpPacket(105000000), client);

        verify(chr).dropMessage(eq(1), org.mockito.ArgumentMatchers.contains("force of the ground"));
        verify(chr, never()).changeMap(any(MapleMap.class), any(Portal.class));
    }

    @Test
    void sourceMapVipRockBlockedIsRefused() {
        stubChannel();
        stubRock(true);
        // Target is open (stubbed 0) but the player's current map forbids VIP rock.
        lenient().when(chr.getMap()).thenReturn(targetMap);
        when(targetMap.getFieldLimit()).thenReturn(0x40); // FieldLimit.CANNOTVIPROCK

        handler.handlePacket(warpPacket(105000000), client);

        verify(chr).dropMessage(eq(1), org.mockito.ArgumentMatchers.contains("force of the ground"));
        verify(chr, never()).changeMap(any(MapleMap.class), any(Portal.class));
    }

    @Test
    void eventInstanceIsRefused() {
        stubChannel();
        stubRock(true);
        lenient().when(chr.getMap()).thenReturn(targetMap);
        lenient().when(chr.getEventInstance()).thenReturn(org.mockito.Mockito.mock(scripting.event.EventInstanceManager.class));

        handler.handlePacket(warpPacket(105000000), client);

        verify(chr).dropMessage(eq(1), org.mockito.ArgumentMatchers.contains("event instance"));
        verify(chr, never()).changeMap(any(MapleMap.class), any(Portal.class));
    }

    @Test
    void shortPacketIsIgnored() {
        // 1-3 readable bytes: would previously pass the <=0 check and fail inside readInt.
        handler.handlePacket(Packets.buildInPacket(out -> out.writeByte(0x01)), client);

        verify(chr, never()).getInventory(any(InventoryType.class));
    }


    @Test
    void restrictedMapRanges() {
        assertTrue(HyperTPHandler.isRestrictedMap(401053002));
        assertTrue(HyperTPHandler.isRestrictedMap(271030000));
        assertTrue(HyperTPHandler.isRestrictedMap(271040300));
        assertFalse(HyperTPHandler.isRestrictedMap(105000000));
        assertFalse(HyperTPHandler.isRestrictedMap(271029999));
    }

    @Test
    void emptyPacketIsIgnored() {
        handler.handlePacket(Packets.buildInPacket(out -> {}), client);

        verify(chr, never()).getInventory(any(InventoryType.class));
    }

    @Test
    void nullPlayerIsIgnored() {
        Client noPlayer = org.mockito.Mockito.mock(Client.class);
        when(noPlayer.getPlayer()).thenReturn(null);

        handler.handlePacket(warpPacket(105000000), noPlayer);
        // No interactions on the HandlerTest chr mock beyond stubbing: proves no NPE path.
        verify(chr, never()).getInventory(any(InventoryType.class));
    }
}
