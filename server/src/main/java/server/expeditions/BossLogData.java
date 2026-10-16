package server.expeditions;

/** MapleRoot boss-attempt summary; attempts include both successful and failed runs. */
public final class BossLogData {
    private int attempts;
    private int completions;

    public void updateAttempts(boolean success) {
        attempts++;
        if (success) {
            completions++;
        }
    }

    public int getAttempts() { return attempts; }
    public int getFailures() { return attempts - completions; }
    public int getCompletions() { return completions; }
}
