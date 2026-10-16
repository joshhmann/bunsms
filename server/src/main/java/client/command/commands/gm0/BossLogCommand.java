package client.command.commands.gm0;

import client.Client;
import client.command.Command;
import server.expeditions.BossLogData;
import server.expeditions.ExpeditionBossLog;

import java.util.Map;

/** MapleRoot boss-log view without its GM account lookup or script framework. */
public final class BossLogCommand extends Command {
    {
        setDescription("Shows your expedition attempts and completed runs.");
    }

    @Override
    public void execute(Client client, String[] params) {
        showSummary(client, false);
        showSummary(client, true);
    }

    private void showSummary(Client client, boolean weekly) {
        client.getPlayer().dropMessage(6, weekly ? "Weekly expedition attempts:" : "Daily expedition attempts:");
        for (Map.Entry<ExpeditionBossLog.BossLogEntry, BossLogData> entry :
                ExpeditionBossLog.getBossEntries(client.getPlayer().getId(), true, weekly).entrySet()) {
            BossLogData data = entry.getValue();
            client.getPlayer().dropMessage(6, entry.getKey().name() + ": " + data.getAttempts() + "/"
                    + entry.getKey().getEntries() + " attempts, " + data.getCompletions() + " completed.");
        }
    }
}
