var status;

function start() {
    status = -1;
    action(1, 0, 0);
}

function action(mode, type, selection) {
    if (mode == -1) {
        im.dispose();
    } else {
        if (mode == 0 && type > 0) {
            im.dispose();
            return;
        }
        if (mode == 1) {
            status++;
        } else {
            status--;
        }

        if (status == 0) {
            if (im.getMapId() == 211060400 && im.isQuestStarted(3182) && im.haveItem(2430159)) {
                var portal = im.getMap().getPortal("east00");
                if (portal != null && portal.getPosition().distance(im.getPlayer().getPosition()) < 310) {
                    im.gainItem(2430159, -1);
                    im.setQuestProgress(3182, "211060400");
                }
            }
            im.dispose();
        }
    }
}
