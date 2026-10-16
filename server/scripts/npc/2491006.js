/*
    This file is part of the HeavenMS MapleStory Server
    Copyleft (L) 2016 - 2019 RonanLana

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as
    published by the Free Software Foundation version 3 as published by
    the Free Software Foundation. You may not use, modify or distribute
    this program under any other version of the GNU Affero General Public License.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program. If not, see <http://www.gnu.org/licenses/>.
*/
/* MapleRoot 2491006; source quest gate and proven expedition registration flow. */
const ExpeditionType = Java.type('server.expeditions.ExpeditionType');
var exped = ExpeditionType.HARDLOTUS;
var status = 0;
var members;

function start() {
    if (cm.getMapId() == 1065 && cm.getEventInstance() != null) {
        status = 10;
        cm.sendYesNo('Leave the Hard Lotus battle and return to the waiting room?');
        return;
    }
    action(1, 0, 0);
}

function action(mode, type, selection) {
    if (mode != 1) {
        cm.dispose();
        return;
    }
    if (status == 10) {
        cm.warp(67, 0);
        cm.dispose();
        return;
    }
    var player = cm.getPlayer();
    var expedition = cm.getExpedition(exped);
    var em = cm.getEventManager('HardLotusBattle');
    if (status == 0) {
        if (player.getLevel() < exped.getMinLevel() || player.getLevel() > exped.getMaxLevel()) {
            cm.sendOk('You do not meet the criteria to battle Hard Lotus.');
            cm.dispose();
        } else if (expedition == null) {
            status = 1;
            cm.sendSimple('Would you like to assemble an expedition to challenge Hard Lotus?\r\n'
                + '#L1#Create an expedition.#l\r\n#L2#Not yet.#l');
        } else if (expedition.isInProgress()) {
            cm.sendOk('Your expedition is already battling Hard Lotus. Registration is closed.');
            cm.dispose();
        } else if (expedition.isLeader(player)) {
            showManagement();
        } else if (expedition.contains(player)) {
            cm.sendOk('You are registered. Please wait for ' + expedition.getLeader().getName() + ' to begin.');
            cm.dispose();
        } else if (expedition.isRegistering()) {
            cm.sendOk(expedition.addMember(player));
            cm.dispose();
        }
    } else if (status == 1) {
        if (selection == 1 && expedition == null) {
            var result = cm.createExpedition(exped);
            cm.sendOk(result == 0 ? 'The Hard Lotus expedition has been created. Talk to me again to manage it.'
                : result > 0 ? 'You have reached your quota of expedition attempts for today.'
                : 'The expedition could not be created.');
        }
        cm.dispose();
    } else if (status == 2) {
        if (expedition == null || !expedition.isLeader(player) || !expedition.isRegistering()) {
            cm.dispose();
            return;
        }
        if (selection == 1) {
            members = expedition.getMemberList();
            var text = 'Expedition leader: ' + expedition.getLeader().getName() + '\r\nSelect a member to expel:\r\n';
            for (var i = 1; i < members.size(); i++) {
                text += '#L' + i + '#' + members.get(i).getValue() + '#l\r\n';
            }
            status = 3;
            cm.sendSimple(text);
        } else if (selection == 2) {
            if (expedition.getActiveMembers().size() < exped.getMinSize() || !expedition.isExpeditionTeamTogether()) {
                cm.sendOk('You need at least ' + exped.getMinSize() + ' registered players together here.');
                cm.dispose();
                return;
            }
            status = 4;
            cm.sendYesNo('Begin the Hard Lotus battle now?');
        } else if (selection == 3) {
            cm.endExpedition(expedition);
            cm.sendOk('The expedition has ended.');
            cm.dispose();
        }
    } else if (status == 3) {
        if (expedition != null && expedition.isLeader(player) && expedition.isRegistering()
                && selection > 0 && selection < members.size()) {
            expedition.ban(members.get(selection));
            cm.sendOk('The member has been expelled.');
        }
        cm.dispose();
    } else if (status == 4) {
        if (expedition == null || !expedition.isLeader(player) || !expedition.isRegistering()) {
            cm.dispose();
            return;
        }
        if (expedition.getActiveMembers().size() < exped.getMinSize() || !expedition.isExpeditionTeamTogether()) {
            cm.sendOk('The expedition members must remain together here before starting.');
            cm.dispose();
            return;
        }
        em.setProperty('leader', player.getName());
        em.setProperty('channel', player.getClient().getChannel());
        if (!em.startInstance(expedition)) {
            cm.sendOk('Another expedition is already challenging Hard Lotus.');
        }
        cm.dispose();
    }
}

function showManagement() {
    status = 2;
    cm.sendSimple('Manage your Hard Lotus expedition:\r\n#L1#View or expel members.#l\r\n'
        + '#L2#Start the fight.#l\r\n#L3#End the expedition.#l');
}
