/*
This file is part of the OdinMS Maple Story Server
Copyright (C) 2008 Patrick Huy <patrick.huy@frz.cc>
Matthias Butz <matze@odinms.de>
Jan Christian Meyer <vimes@odinms.de>

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation version 3 as published by
the Free Software Foundation. You may not use, modify or distribute
this program under any other version of the GNU Affero General Public
License.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
package client.inventory;

import client.inventory.manipulator.KarmaManipulator;
import constants.inventory.ItemConstants;
import server.ItemInformationProvider;

import java.util.Collections;
import java.util.LinkedList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

public class Item implements Comparable<Item> {

    private static final AtomicInteger runningCashId = new AtomicInteger(777000000);  // pets & rings shares cashid values

    private final int id;
    private int cashId;
    private int sn;
    private short position;
    private short quantity;
    private int petid = -1;
    private Pet pet = null;
    private String owner = "";
    protected List<String> itemLog;
    private short flag;
    private long expiration = -1;
    private String giftFrom = "";
    // Coloring prism (ticket #11): cash-effect-item tint (5010000..5019999).
    // An effect item IS the effect, so it carries one tint, not the body+fx pair Equip has.
    private short effTintHue = 0;
    private byte effTintChroma = 0;
    private byte effTintBright = 0;

    public Item(int id, short position, short quantity) {
        this.id = id;
        this.position = position;
        this.quantity = quantity;
        this.itemLog = new LinkedList<>();
        this.flag = 0;
    }

    public Item(int id, short position, short quantity, int petid) {
        this.id = id;
        this.position = position;
        this.quantity = quantity;
        if (petid > -1) {   // issue with null "pet" having petid > -1 found thanks to MedicOP
            this.pet = Pet.loadFromDb(id, position, petid);
            if (this.pet == null) {
                petid = -1;
            }
        }
        this.petid = petid;
        this.flag = 0;
        this.itemLog = new LinkedList<>();
    }

    public Item copy() {
        Item ret = new Item(id, position, quantity, petid);
        ret.flag = flag;
        ret.owner = owner;
        ret.expiration = expiration;
        ret.effTintHue = effTintHue;
        ret.effTintChroma = effTintChroma;
        ret.effTintBright = effTintBright;
        ret.itemLog = new LinkedList<>(itemLog);
        return ret;
    }

    public void setPosition(short position) {
        this.position = position;
        if (this.pet != null) {
            this.pet.setPosition(position);
        }
    }

    public void setQuantity(short quantity) {
        this.quantity = quantity;
    }

    public int getItemId() {
        return id;
    }

    public int getCashId() {
        if (cashId == 0) {
            cashId = runningCashId.getAndIncrement();
        }
        return cashId;
    }

    public short getPosition() {
        return position;
    }

    public short getQuantity() {
        return quantity;
    }

    public InventoryType getInventoryType() {
        return ItemConstants.getInventoryType(id);
    }

    public byte getItemType() { // 1: equip, 3: pet, 2: other
        if (getPetId() > -1) {
            return 3;
        }
        return 2;
    }

    public String getOwner() {
        return owner;
    }

    public void setOwner(String owner) {
        this.owner = owner;
    }

    public int getPetId() {
        return petid;
    }

    @Override
    public int compareTo(Item other) {
        if (this.id < other.getItemId()) {
            return -1;
        } else if (this.id > other.getItemId()) {
            return 1;
        }
        return 0;
    }

    @Override
    public String toString() {
        return "Item: " + id + " quantity: " + quantity;
    }

    public List<String> getItemLog() {
        return Collections.unmodifiableList(itemLog);
    }

    public short getFlag() {
        return flag;
    }

    public void setFlag(short b) {
        ItemInformationProvider ii = ItemInformationProvider.getInstance();
        if (ii.isAccountRestricted(id)) {
            b |= ItemConstants.ACCOUNT_SHARING; // thanks Shinigami15 for noticing ACCOUNT_SHARING flag not being applied properly to items server-side
        }

        this.flag = b;
    }

    public long getExpiration() {
        return expiration;
    }

    public void setExpiration(long expire) {
        this.expiration = !ItemConstants.isPermanentItem(id) ? expire : ItemConstants.isPet(id) ? Long.MAX_VALUE : -1;
    }

    public int getSN() {
        return sn;
    }

    public void setSN(int sn) {
        this.sn = sn;
    }

    public String getGiftFrom() {
        return giftFrom;
    }

    public void setGiftFrom(String giftFrom) {
        this.giftFrom = giftFrom;
    }
    public short getEffTintHue()    { return effTintHue; }
    public byte  getEffTintChroma() { return effTintChroma; }
    public byte  getEffTintBright() { return effTintBright; }
    public boolean isEffTinted() {
        return effTintHue != 0 || effTintChroma != 0 || effTintBright != 0;
    }

    public void setEffTint(int hue, int chroma, int bright) {
        this.effTintHue    = (short) normalizeTintHue(hue);
        this.effTintChroma = (byte) Math.max(-100, Math.min(100, chroma));
        this.effTintBright = (byte) Math.max(-100, Math.min(100, bright));
    }

    public void clearEffTint() { effTintHue = 0; effTintChroma = 0; effTintBright = 0; }

    /**
     * Tint-hue sign convention (shared with Equip/Character): positive 1..359 rotates the
     * sprite's own hue; negative -1..-360 selects an absolute target as -(degrees + 1);
     * zero leaves the hue alone. Only the positive half wraps — a plain floorMod(hue, 360)
     * would turn -1 ("absolute red") into 359 ("rotate by 359").
     */
    protected static int normalizeTintHue(int hue) {
        if (hue < 0) {
            return hue < -360 ? -360 : hue;
        }
        return Math.floorMod(hue, 360);
    }


    public Pet getPet() {
        return pet;
    }

    public boolean isUntradeable() {
        return ((this.getFlag() & ItemConstants.UNTRADEABLE) == ItemConstants.UNTRADEABLE) || (ItemInformationProvider.getInstance().isDropRestricted(this.getItemId()) && !KarmaManipulator.hasKarmaFlag(this));
    }
}
