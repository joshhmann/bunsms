function act() {
    if(rm.getPlayer().getEventInstance() != null){
		rm.getPlayer().getEventInstance().setProperty("summoned", "true");
		rm.getPlayer().getEventInstance().setProperty("canEnter", "false");
	}
    rm.changeMusic("Bgm06/FinalFight");
    rm.spawnMonster(9420521);
    if (rm.getPlayer().getEventInstance() == null) {
        rm.createMapMonitor(541020800, "ps00");
    }
    rm.mapMessage(5, "Krexel appears!");
}
