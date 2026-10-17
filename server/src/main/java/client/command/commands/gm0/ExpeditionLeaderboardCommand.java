package client.command.commands.gm0;

import client.Client;
import client.command.Command;

/** MapleRoot's ordinary-player leaderboard entry, using a named NPC script. */
public final class ExpeditionLeaderboardCommand extends Command {
    {
        setDescription("Shows global or personal expedition clear-time leaderboards.");
    }

    @Override
    public void execute(Client client, String[] params) {
        client.getAbstractPlayerInteraction().openNpc(9000041, "expeditionLeaderboard");
    }
}
