package net.server.world;

import net.server.PlayerStorage;
import org.junit.jupiter.api.Test;
import org.objenesis.ObjenesisStd;

import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/**
 * Bots are simulated Characters resident in world storage. They must not
 * consume human admission slots: charlist/charselect gates on
 * isWorldCapacityFull() must stay open while thousands of bots are online,
 * and must still close when real humans fill the world.
 *
 * World is allocated via Objenesis (constructor registers server timers —
 * unsuitable for unit tests); only the players store + channel count are
 * wired, and the real capacity methods run unmocked.
 */
public class WorldCapacityBotsTest {

    private static Field findField(Class<?> cls, String name) throws Exception {
        for (Class<?> c = cls; c != null; c = c.getSuperclass()) {
            try {
                return c.getDeclaredField(name);
            } catch (NoSuchFieldException e) {
                // walk up
            }
        }
        throw new NoSuchFieldException(name);
    }

    private World worldWithIds(List<Integer> ids) throws Exception {
        World world = spy(new ObjenesisStd().newInstance(World.class));
        PlayerStorage storage = new PlayerStorage();
        Field nameField = findField(client.Character.class, "name");
        nameField.setAccessible(true);
        Field idField = findField(client.Character.class, "id");
        idField.setAccessible(true);
        for (int id : ids) {
            client.Character chr = new ObjenesisStd().newInstance(client.Character.class);
            nameField.set(chr, "mock" + id);
            idField.setInt(chr, id);
            storage.addPlayer(chr);
        }
        Field f = World.class.getDeclaredField("players");
        f.setAccessible(true);
        f.set(world, storage);
        doReturn(3).when(world).getChannelsSize();
        return world;
    }

    private int channelLoad() {
        return config.YamlConfig.config.server.CHANNEL_LOAD;
    }

    @Test
    void botsDoNotConsumeHumanSlots() throws Exception {
        // 3168 bots (ids > 20000 per BotHelpers.isArtificial) + 0 humans
        List<Integer> ids = new ArrayList<>();
        for (int i = 0; i < 3168; i++) ids.add(20001 + i);
        World world = worldWithIds(ids);
        assertEquals(0, world.getHumanPlayerCount());
        assertFalse(world.isWorldCapacityFull(),
                "3168 bots must not wedge charlist at SERVERSTATUS 2");
        assertEquals(0, world.getWorldCapacityStatus());
    }

    @Test
    void humanCapStillEnforced() throws Exception {
        int cap = 3 * channelLoad();
        List<Integer> ids = new ArrayList<>();
        for (int i = 1; i <= cap; i++) ids.add(i); // human ids (<= 20000, != 999)
        World world = worldWithIds(ids);
        assertEquals(cap, world.getHumanPlayerCount());
        assertTrue(world.isWorldCapacityFull(),
                "300 real humans must still trip capacity");
        assertEquals(2, world.getWorldCapacityStatus());
    }

    @Test
    void mixedBotsPlusHumansCountsHumansOnly() throws Exception {
        List<Integer> ids = new ArrayList<>();
        for (int i = 0; i < 3168; i++) ids.add(20001 + i);
        for (int i = 1; i <= 10; i++) ids.add(i);
        World world = worldWithIds(ids);
        assertEquals(10, world.getHumanPlayerCount());
        assertFalse(world.isWorldCapacityFull());
    }
}
