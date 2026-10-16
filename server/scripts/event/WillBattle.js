/*
    This file is part of the HeavenMS MapleStory Server
    Copyleft (L) 2016 - 2019 RonanLana

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as
    published by the Free Software Foundation version 3 as published by
    the Free Software Foundation. You may not use, modify or distribute
    this program under any other version of the GNU Affero General Public
    License.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program. If not, see <http://www.gnu.org/licenses/>.
*/
/* MapleRoot WillBattle: source maps, timers, monsters and rewards; guarded completion/cleanup. */
const ExpeditionType = Java.type('server.expeditions.ExpeditionType');
var isPq = true;
var minPlayers = 1, maxPlayers = 6;
var minLevel = 200, maxLevel = 255;
var entryMap = 450007440;
var exitMap = 450007240;
var recruitMap = 450007240;
var clearMap = 450007240;
var minMapId = 450007440, maxMapId = 450007440;
var eventTime = 120;
const maxLobbies = 1;

function init() {
    em.setProperty('party', '\r\n    Number of players: ' + minPlayers + ' ~ ' + maxPlayers
        + '\r\n    Level range: ' + minLevel + ' ~ ' + maxLevel
        + '\r\n    Time limit: ' + eventTime + ' minutes');
}

function getMaxLobbies() { return maxLobbies; }

function getEligibleParty(party) {
    var eligible = [];
    var hasLeader = false;
    var members = party.toArray();
    for (var i = 0; i < members.length; i++) {
        var member = members[i];
        if (member.getMapId() == recruitMap && member.getLevel() >= minLevel && member.getLevel() <= maxLevel) {
            hasLeader = hasLeader || member.isLeader();
            eligible.push(member);
        }
    }
    if (!hasLeader || eligible.length < minPlayers || eligible.length > maxPlayers) {
        eligible = [];
    }
    return Java.to(eligible, Java.type('net.server.world.PartyCharacter[]'));
}

function setup(level, lobbyid) {
    var eim = em.newInstance('Hard Will' + lobbyid);
    eim.setProperty('level', level);
    eim.setProperty('boss', '0');
    eim.setIntProperty('fallenPlayers', 0);
    eim.getInstanceMap(entryMap).resetPQ(level);
    eim.setExclusiveItems([]);
    eim.setEventRewards(1, [], []);
    eim.setEventClearStageExp([]);
    eim.startEventTimer(eventTime * 60000);
    return eim;
}

function afterSetup(eim) {}

function playerEntry(eim, player) {
    var map = eim.getMapInstance(entryMap);
    player.changeMap(map, map.getPortal(0));
}

function scheduledTimeout(eim) { end(eim); }
function playerUnregistered(eim, player) {}

function playerExit(eim, player) {
    eim.unregisterPlayer(player);
    player.changeMap(exitMap, 0);
}

function playerLeft(eim, player) { playerExit(eim, player); }

function changedMap(eim, player, mapid) {
    if (mapid < minMapId || mapid > maxMapId) {
        var finish = eim.isExpeditionTeamLackingNow(true, minPlayers, player);
        eim.unregisterPlayer(player);
        if (finish) {
            end(eim);
        }
    }
}

function changedLeader(eim, leader) {}
function playerDead(eim, player) {
    var count = eim.getIntProperty('fallenPlayers') + 1;
    eim.setIntProperty('fallenPlayers', count);
    if (count == 10) {
        eim.dropMessage(5, '[Expedition] Too many players have fallen; the expedition is over.');
        end(eim);
    } else if (count == 9) {
        eim.dropMessage(6, '[Expedition] This is your last chance! Do NOT die!');
    } else if (count == 5) {
        eim.dropMessage(6, '[Expedition] Casualty count is starting to get out of control. Battle with care.');
    }
}

function unregisterLeavingPlayer(eim, player) {
    var finish = eim.isExpeditionTeamLackingNow(true, minPlayers, player);
    eim.unregisterPlayer(player);
    if (finish) {
        end(eim);
    }
}

function playerRevive(eim, player) { unregisterLeavingPlayer(eim, player); }
function playerDisconnected(eim, player) { unregisterLeavingPlayer(eim, player); }
function leftParty(eim, player) {}
function disbandParty(eim) {}
function monsterValue(eim, mobId) { return 1; }

function end(eim) {
    var players = eim.getPlayers();
    for (var i = 0; i < players.size(); i++) {
        playerExit(eim, players.get(i));
    }
    eim.dispose();
}

function giveRandomEventReward(eim, player) { eim.giveEventReward(player); }
function clearPQ(eim) { eim.completeExpedition(ExpeditionType.WILLSPIDER); }

function monsterKilled(mob, eim, hasKiller) {
    if (hasKiller && !eim.isEventCleared() && mob.getId() == 8880301) {
        var Point = Java.type('java.awt.Point');
        var positions = [-1794, -618, -568, -1844];
        for (var n = 0; n < positions.length; n++) {
            mob.getMap().spawnMonsterOnGroundBelow(em.getMonster(9990071), new Point(positions[n], 215));
        }
    }
    if (!hasKiller || mob.getId() != 8880302 || eim.isEventCleared()) {
        return;
    }
    clearPQ(eim);
    eim.showClearEffect();
    var players = eim.getPlayers();
    for (var i = 0; i < players.size(); i++) {
        players.get(i).getClient().getAbstractPlayerInteraction().gainItem(4001126, 500);
    }
    mob.getMap().killAllMonsters();
}

function allMonstersDead(eim) {}
function cancelSchedule() {}
function dispose(eim) {}
