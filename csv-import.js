/**
 * Import equipment data from the game's own CSV export (added by the
 * developer after this site launched) — either a picked .csv file or pasted
 * text (the game's export screen lets you copy the content directly without
 * saving a file).
 *
 * The CSV's own march_set_id/instanced_set_id columns are present in the
 * schema but empty on every row we've seen — a gap in the
 * export, not something we can fix client-side. EQUIPMENT_DEF_ID_TO_SET
 * below is a manual workaround: known equipmentDefId -> setId mappings,
 * cross-referenced by hand against each item's in-game set tooltip. Any
 * def id not listed here imports with setId: null (no set bonus shown)
 * until someone adds it.
 */
const EQUIPMENT_DEF_ID_TO_SET = {
  beastfang_dagger: "beast",
  wolfhide_vest: "beast",
  trackers_hood: "beast",
  stalker_boots: "beast",
  uncommon_miners_pick: "gatherers",
  epic_master_miners_helm: "gatherers",
  uncommon_merchants_pouch: "gatherers",
  conqueror_amulet: "conqueror",
  conqueror_plate: "conqueror",
  conqueror_helm: "conqueror",
  conqueror_boots: "conqueror",
  conqueror_blade: "conqueror",
  conqueror_ring: "conqueror",
  warden_greaves: "warden",
  warden_blade: "warden",
  warden_amulet: "warden",
  warden_ring: "warden",
  warden_aegis: "warden",
  warden_helm: "warden",
};

/** Minimal RFC4180 CSV parser: handles quoted fields, embedded commas,
 * embedded newlines, and doubled-quote escaping ("" -> "). No external
 * dependency — this is the only CSV parsing the site needs. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (char === "\r") {
      i += 1;
      continue;
    }
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }

  // Final field/row if the text doesn't end with a trailing newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ""));
}

function csvRowsToObjects(rows) {
  if (!rows.length) return [];
  const header = rows[0];
  return rows.slice(1).map((row) => {
    const obj = {};
    header.forEach((key, idx) => { obj[key] = row[idx] !== undefined ? row[idx] : ""; });
    return obj;
  });
}

function safeJsonParse(text, fallback) {
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch (err) {
    return fallback;
  }
}

function slotMapFromItemIds(itemIds, equipmentByItemId) {
  const map = {};
  for (const slot of SLOT_ORDER) map[slot] = null;
  for (const itemId of itemIds) {
    const it = equipmentByItemId.get(itemId);
    if (it && it.slot) map[it.slot] = itemId;
  }
  return map;
}

function slotMapsEqual(a, b) {
  return SLOT_ORDER.every((slot) => a[slot] === b[slot]);
}

/** Convert the game's CSV export text into the same {heroes, equipment,
 * knownSetSizes} shape as equipment-data.json, so it can go through the
 * exact same applyEquipmentData() path as a manually-exported JSON file.
 * Also returns heroLoadouts — each hero's actually-equipped gear, built
 * from the hero row's own march_item_ids/instanced_item_ids.
 *
 * A hero can have two independent equip states at once — "march" and
 * "instanced" (e.g. a PvP set and a dungeon set) — which can differ item
 * for item. When they differ for a given hero, that hero is split into two
 * owner entries (e.g. "Cassian — PvP" and "Cassian — Dens", using the
 * game's own set name where one is on record) instead of collapsing both
 * states into one loadout and silently losing or misattributing gear. */
function convertCsvToEquipmentData(csvText) {
  const rows = csvRowsToObjects(parseCsv(csvText));
  if (!rows.length) {
    throw new Error("The CSV has no data rows.");
  }

  const heroRows = rows.filter((r) => r.record_type === "hero");
  const equipmentRows = rows.filter((r) => r.record_type === "equipment");
  if (!equipmentRows.length) {
    throw new Error("No equipment rows found — is this the right CSV export?");
  }

  const equipmentByItemId = new Map();
  const equipmentRowByItemId = new Map();
  const setMemberDefIds = {};
  const equipment = equipmentRows.map((r) => {
    equipmentRowByItemId.set(r.item_id, r);
    const rawStatsFull = safeJsonParse(r.resolved_stats, {});
    const rawStats = {};
    for (const [key, value] of Object.entries(rawStatsFull)) {
      if (value) rawStats[key] = value;
    }

    const setId = EQUIPMENT_DEF_ID_TO_SET[r.equipment_definition_id] || null;
    if (setId) {
      setMemberDefIds[setId] = setMemberDefIds[setId] || new Set();
      setMemberDefIds[setId].add(r.equipment_definition_id);
    }

    const it = {
      id: r.item_id,
      defId: r.equipment_definition_id,
      name: r.name,
      slot: r.slot,
      rarity: r.rarity,
      level: parseInt(r.level, 10) || 0,
      setId,
      equippedByOwnerIds: [],
      rawStats,
      stats: nonzeroStats(rawStats),
    };
    equipmentByItemId.set(r.item_id, it);
    return it;
  });

  // A set name attached to an item only tells us the name — NOT which of
  // that hero's two equip states (march vs instanced) it belongs to; the
  // game's export doesn't consistently put "Dens" under instanced_set_name
  // just because an item is in that hero's instanced_item_ids. So the label
  // for march/instanced is derived from actual list membership: for each
  // hero, look at any item that's in march_item_ids but NOT instanced_item_ids
  // (or vice versa) and use whichever set name is recorded on that item's row.
  function setLabelForExclusiveItems(itemIds, otherItemIds, heroId) {
    const otherSet = new Set(otherItemIds);
    for (const itemId of itemIds) {
      if (otherSet.has(itemId)) continue;
      const r = equipmentRowByItemId.get(itemId);
      if (!r) continue;
      const name = (r.march_set_owner_hero_id === heroId && r.march_set_name)
        || (r.instanced_set_owner_hero_id === heroId && r.instanced_set_name)
        || null;
      if (name) return name;
    }
    return null;
  }

  const heroes = [];
  const heroLoadouts = {};

  for (const r of heroRows) {
    if (!r.hero_id) continue;
    const heroDisplayName = r.hero_name || r.hero_id;
    const marchItemIds = safeJsonParse(r.march_item_ids, []);
    const instancedItemIds = safeJsonParse(r.instanced_item_ids, []);
    const marchMap = slotMapFromItemIds(marchItemIds, equipmentByItemId);
    const instancedMap = slotMapFromItemIds(instancedItemIds, equipmentByItemId);

    const assign = (ownerId, slotMap) => {
      for (const itemId of Object.values(slotMap)) {
        if (itemId) equipmentByItemId.get(itemId).equippedByOwnerIds.push(ownerId);
      }
    };

    if (slotMapsEqual(marchMap, instancedMap)) {
      heroes.push({ id: r.hero_id, name: heroDisplayName });
      heroLoadouts[r.hero_id] = marchMap;
      assign(r.hero_id, marchMap);
    } else {
      const marchLabel = setLabelForExclusiveItems(marchItemIds, instancedItemIds, r.hero_id) || "March";
      const instancedLabel = setLabelForExclusiveItems(instancedItemIds, marchItemIds, r.hero_id) || "Instanced";
      const marchOwnerId = `${r.hero_id}::march`;
      const instancedOwnerId = `${r.hero_id}::instanced`;
      heroes.push({ id: marchOwnerId, name: `${heroDisplayName} — ${marchLabel}` });
      heroes.push({ id: instancedOwnerId, name: `${heroDisplayName} — ${instancedLabel}` });
      heroLoadouts[marchOwnerId] = marchMap;
      heroLoadouts[instancedOwnerId] = instancedMap;
      assign(marchOwnerId, marchMap);
      assign(instancedOwnerId, instancedMap);
    }
  }

  const knownSetSizes = {};
  for (const [setId, defIds] of Object.entries(setMemberDefIds)) {
    knownSetSizes[setId] = defIds.size;
  }

  return { heroes, equipment, knownSetSizes, heroLoadouts };
}
