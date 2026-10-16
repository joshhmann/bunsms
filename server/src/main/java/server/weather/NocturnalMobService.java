/*
 This file is part of a Maple Story Server and is redistributed under the
    licence below
 Copyright (C) 2026 this project

 This program is free software: you can redistribute it and/or modify
 it under the terms of the GNU Affero General Public License as
 published by the Free Software Foundation version 3 as published by
 the Free Software Foundation. You may not use, modify or distribute
 this program under any other version of the GNU Affero General Public License.
*/
package server.weather;

import client.Character;
import net.server.world.World;
import server.life.LifeFactory;
import server.life.Monster;
import server.maps.MapleMap;
import tools.Randomizer;

import java.awt.Point;
import java.util.ArrayList;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Small, regional encounters that exist only after nightfall.
 *
 * <p>This deliberately does not add {@code SpawnPoint}s. Ordinary SpawnPoints are part
 * of the WZ population cap and are multiplied by the normal night-density system; these
 * encounters need their own modest cap so they add character to a field without replacing
 * its intended daytime population. Spawn locations are nevertheless borrowed from ordinary
 * WZ field spawns, never invented coordinates.
 */
public final class NocturnalMobService {
    private NocturnalMobService() {
    }

    /** One lock covers the small state table and prevents entry and weather ticks racing. */
    private static final Object LOCK = new Object();

    /** Identity matters: two channels can hold separate MapleMap instances with one id. */
    private static final Map<MapleMap, NocturnalState> SPAWNED = new IdentityHashMap<>();

    /** A map rolls one target on first night entry and keeps it until dawn. */
    private static final class NocturnalState {
        private final int target;
        private final List<Monster> monsters = new ArrayList<>();

        private NocturnalState(int target) {
            this.target = target;
        }
    }

    /**
     * Initial regional roster. Each field rolls one stable target in its range for the
     * whole night, so a night feels populated without the cap visibly changing every
     * minute as the WeatherTask refreshes it.
     *
     * <ul>
     *   <li>Stirge (2300100): Henesys bats</li>
     *   <li>Fairy 1 / Jr. Wraith (3000001 / 3230101): Ellinia wisps and ghosts</li>
     *   <li>Jr. Necki (2130103): Kerning's Snekis</li>
     *   <li>Fire Boar (3210100): Perion</li>
     *   <li>Lorang (3230102): Lith Harbour's moonlit shore</li>
     * </ul>
     */
    private enum Pool {
        HENESYS(WeatherRegion.HENESYS, 3, 5, 2300100),
        ELLINIA(WeatherRegion.ELLINIA, 4, 6, 3000001, 3230101),
        KERNING(WeatherRegion.KERNING_CITY, 3, 5, 2130103),
        PERION(WeatherRegion.PERION, 3, 4, 3210100),
        LITH_HARBOUR(WeatherRegion.LITH_HARBOUR, 3, 5, 3230102);

        private final WeatherRegion region;
        private final int minCap;
        private final int maxCap;
        private final int[] mobIds;

        Pool(WeatherRegion region, int minCap, int maxCap, int... mobIds) {
            this.region = region;
            this.minCap = minCap;
            this.maxCap = maxCap;
            this.mobIds = mobIds;
        }

        private int targetForNight() {
            return minCap + Randomizer.nextInt(maxCap - minCap + 1);
        }

        private int nextMobId() {
            return mobIds[Randomizer.nextInt(mobIds.length)];
        }

        private static Pool forMap(int mapId) {
            WeatherRegion region = WeatherRegion.forMap(mapId);
            for (Pool pool : values()) {
                if (pool.region == region) {
                    return pool;
                }
            }
            return null;
        }
    }

    /** Called once per WeatherTask tick. Only occupied maps are considered at night. */
    public static void refreshWorld(World world) {
        if (world == null || world.getPlayerStorage() == null || !WeatherCombat.gameplayEnabled()) {
            return;
        }
        synchronized (LOCK) {
            if (!WeatherService.isNight()) {
                despawnAll();
                return;
            }

            Set<MapleMap> occupiedMaps = Collections.newSetFromMap(new IdentityHashMap<>());
            for (Character chr : world.getPlayerStorage().getAllCharacters()) {
                if (chr.getMap() != null) {
                    occupiedMaps.add(chr.getMap());
                }
            }
            // A map that has emptied since the previous tick is otherwise never seen
            // again until dawn, so its ambient monsters and strong references linger
            // for the rest of the night. Check the map itself rather than only this
            // world's set: SPAWNED holds distinct channel instances by identity.
            for (MapleMap map : new ArrayList<>(SPAWNED.keySet())) {
                if (map.getCharacters().isEmpty()) {
                    despawnMap(map);
                }
            }
            for (MapleMap map : occupiedMaps) {
                refreshMapLocked(map);
            }
        }
    }

    /** Called on map entry so an eligible field is ready immediately at night. */
    public static void refreshMap(MapleMap map) {
        if (map == null || !WeatherCombat.gameplayEnabled()) {
            return;
        }
        synchronized (LOCK) {
            if (WeatherService.isNight()) {
                refreshMapLocked(map);
            } else {
                despawnMap(map);
            }
        }
    }

    private static void refreshMapLocked(MapleMap map) {
        Pool pool = Pool.forMap(map.getId());
        // Towns and instanced/event maps never receive ambient encounters. The latter
        // can share a regional map id but have tightly scripted population rules.
        if (pool == null || map.isTown() || map.getEventInstance() != null) {
            despawnMap(map);
            return;
        }

        List<Point> anchors = map.getNocturnalSpawnPositions();
        if (anchors.isEmpty()) {
            return;
        }

        NocturnalState state = SPAWNED.computeIfAbsent(map,
                ignored -> new NocturnalState(pool.targetForNight()));
        state.monsters.removeIf(monster -> !isStillInMap(map, monster));
        int missing = state.target - state.monsters.size();
        if (missing <= 0) {
            return;
        }

        Collections.shuffle(anchors);
        for (int i = 0; i < missing && i < anchors.size(); i++) {
            Monster monster = LifeFactory.getMonster(pool.nextMobId());
            if (monster == null) {
                continue;
            }
            monster.setNocturnal(true);
            map.spawnMonsterOnGroundBelow(monster, anchors.get(i));
            // A map with a hard scripted capacity may reject the normal spawn call.
            if (monster.getMap() == map) {
                state.monsters.add(monster);
            }
        }
    }

    private static boolean isStillInMap(MapleMap map, Monster monster) {
        return monster != null && monster.isAlive() && map.getMonsterByOid(monster.getObjectId()) == monster;
    }

    private static void despawnAll() {
        for (MapleMap map : new ArrayList<>(SPAWNED.keySet())) {
            despawnMap(map);
        }
    }

    /** Dawn removal awards neither EXP nor drops and leaves the normal field untouched. */
    private static void despawnMap(MapleMap map) {
        NocturnalState state = SPAWNED.remove(map);
        if (state == null) {
            return;
        }
        for (Monster monster : state.monsters) {
            if (isStillInMap(map, monster)) {
                map.killMonster(monster, null, false, (short) 0);
            }
        }
    }
}
