/* Ticket 8 search-first QoL: reuse public WhatDrops/WhoDrops, never the source admin spawn/grant tool. */
const CommandsExecutor = Java.type('client.command.CommandsExecutor');
var status = 0;
var command;
function start() {
    cm.sendSimple('What would you like to search?\r\n#L0#What items drop from a monster?#l\r\n#L1#Which monsters drop an item?#l');
}
function action(mode, type, selection) {
    if (mode != 1) {
        cm.dispose();
        return;
    }
    if (status == 0) {
        if (selection != 0 && selection != 1) {
            cm.dispose();
            return;
        }
        command = selection == 0 ? '@whatdropsfrom ' : '@whodrops ';
        status = 1;
        cm.sendGetText(selection == 0 ? 'Enter a monster name.' : 'Enter an item name.');
    } else {
        var query = cm.getText().trim();
        var client = cm.getClient();
        cm.dispose();
        if (query.length > 0) CommandsExecutor.getInstance().handle(client, command + query);
    }
}
