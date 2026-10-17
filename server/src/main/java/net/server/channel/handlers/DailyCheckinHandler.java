/*
    Daily Check-In window — server side.

    A 28-day login-streak grid, gated to one claim per 24 hours. Streak state lives on Character
    (checkinDay / checkinClaimed / checkinLastClaim). The client only REQUESTS; the server is the
    source of truth: it normalizes the streak by timestamp, validates the claim, grants the reward
    (server.DailyCheckinRewards), and replies with a fresh snapshot (PacketCreator.dailyCheckinSnapshot).

    Wire (client -> server, RecvOpcode.DAILY_CHECKIN = 0x11A):
      byte action  0 = OPEN (just snapshot), 1 = CLAIM
      CLAIM : byte day (1..28)
    Reply (SendOpcode.DAILY_CHECKIN = 0x17C) after every action.

    Client window/hooks/addresses live DLL-side (Detours against Kaentake/stock);
    this handler is the canonical server half.
*/
package net.server.channel.handlers;

import client.Character;
import client.Client;
import net.AbstractPacketHandler;
import net.packet.InPacket;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import server.DailyCheckinRewards;
import tools.PacketCreator;

public final class DailyCheckinHandler extends AbstractPacketHandler {

    private static final Logger log = LoggerFactory.getLogger(DailyCheckinHandler.class);
    private static final int REQ_OPEN = 0, REQ_CLAIM = 1;

    @Override
    public void handlePacket(InPacket p, Client c) {
        Character player = c.getPlayer();
        if (player == null) {
            return;
        }
        if (!c.hasCaps(client.ClientCaps.CHECKIN_WINDOW)) {
            return;
        }
        int action = p.readByte();

        // Level gate (defense-in-depth; the window also isn't pushed to lower-level characters).
        if (player.getLevel() < DailyCheckinRewards.MIN_LEVEL) {
            return;
        }

        // Normalize the 24h streak and find the day claimable right now (0 = still on cooldown).
        int claimable = player.refreshCheckin();

        int justClaimed = 0;
        try {
            if (action == REQ_CLAIM) {
                int day = p.readByte();
                if (claimable >= 1 && day == claimable) {
                    if (DailyCheckinRewards.claimDay(c, day)) {
                        justClaimed = day;
                        claimable = 0;           // now on cooldown until +24h
                        log.info("[DailyCheckin] {} claimed day {}", player.getName(), day);
                    }
                } else {
                    log.info("[DailyCheckin] {} claim rejected day={} claimable={} cooldownSecs={}",
                            player.getName(), day, claimable, player.getCheckinCooldownSeconds());
                }
            }
        } catch (Exception e) {
            // never let a malformed request crash the channel packet thread — but log it.
            log.warn("[DailyCheckin] action={} threw", action, e);
        }

        // currentDay sent to the client = the claimable day (if any), else the last claimed day so
        // nothing extra shows unlocked during the cooldown.
        int viewDay = claimable >= 1 ? claimable : player.getCheckinDay();
        c.sendPacket(PacketCreator.dailyCheckinSnapshot(viewDay, player.getCheckinClaimed(), justClaimed));
    }
}
