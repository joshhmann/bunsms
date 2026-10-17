/*  Author: Rulax
	NPC Name: 		Neinheart (2143001)
	Map(s): 		Secret Grove
	Description: 	Rescuing Neinheart
*/

function end(mode, type, selection) {
    if (mode == 1) {
        const Quest = Java.type('server.quest.Quest');
        Quest.getInstance(qm.getQuest()).complete(qm.getPlayer(), qm.getNpc());
    }
    qm.dispose();
}
