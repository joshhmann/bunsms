/* MapleRoot source Dream Key approach. */
function enter(pi) {
    if (!pi.isQuestCompleted(31151)) {
        pi.dropMessage(5, 'You must complete the Dream Key quest to enter the Hallowed Grounds.');
        return false;
    }
    pi.openNpc(2143000, '2143000');
    return true;
}
