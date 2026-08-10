/**
 * SAMPLE DATA — not a real account. Placeholder gear for demoing the loadout
 * builder until real gear is loaded via the Data menu. Item names are real
 * (from the game's own item list); levels, stat rolls, and hero names are
 * made up.
 */

const STAT_LABELS = {
  attack: "Attack",
  defense: "Defense",
  health: "Health",
  marchSpeed: "March Speed",
  gatherSpeed: "Gather Speed",
  gatherSpeedFood: "Gather Speed (Food)",
  gatherSpeedWood: "Gather Speed (Wood)",
  gatherSpeedStone: "Gather Speed (Stone)",
  gatherSpeedGold: "Gather Speed (Gold)",
  pvpAttack: "PvP Attack",
  pvpDefense: "PvP Defense",
  pvpDamageMultiplier: "PvP Damage Mult.",
  pvpDamageReduction: "PvP Damage Reduction",
  attackPercent: "Attack %",
  defensePercent: "Defense %",
  healthPercent: "Health %",
  infantryAttack: "Infantry Attack",
  infantryDefense: "Infantry Defense",
  infantryHealth: "Infantry Health",
  archerAttack: "Archer Attack",
  archerDefense: "Archer Defense",
  archerHealth: "Archer Health",
  cavalryAttack: "Cavalry Attack",
  cavalryDefense: "Cavalry Defense",
  cavalryHealth: "Cavalry Health",
  garrisonDefense: "Garrison Defense",
  firstRoundDamage: "First Round Damage",
  wallHealth: "Wall Health",
  trainingSpeed: "Training Speed",
  healingSpeed: "Healing Speed",
  marchCapacity: "March Capacity",
  nodeYield: "Node Yield",
  monsterDamage: "Monster Damage",
  monsterDamageReduction: "Monster Damage Reduction",
  dungeonDamage: "Dungeon Damage",
  dungeonDamageReduction: "Dungeon Damage Reduction",
};

const PERCENT_STATS = new Set([
  "marchSpeed", "gatherSpeed", "gatherSpeedFood", "gatherSpeedWood",
  "gatherSpeedStone", "gatherSpeedGold", "pvpDefense", "pvpDamageMultiplier",
  "pvpDamageReduction", "attackPercent", "defensePercent", "healthPercent",
  "infantryAttack", "infantryDefense", "infantryHealth", "archerAttack",
  "archerDefense", "archerHealth", "cavalryAttack", "cavalryDefense",
  "cavalryHealth", "garrisonDefense", "firstRoundDamage", "wallHealth",
  "trainingSpeed", "healingSpeed", "marchCapacity", "nodeYield",
  "monsterDamage", "monsterDamageReduction", "dungeonDamage",
  "dungeonDamageReduction", "pvpAttack",
]);

const SLOT_ORDER = ["WEAPON", "HELM", "ARMOR", "ACCESSORY", "BOOTS", "RING"];
const RARITY_ORDER = ["COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"];

function fmtStat(key, value) {
  if (!value) return "";
  const label = STAT_LABELS[key] || key;
  if (PERCENT_STATS.has(key)) return `${label} +${(value * 100).toFixed(2)}%`;
  return `${label} +${Math.round(value).toLocaleString()}`;
}

function nonzeroStats(stats) {
  const out = [];
  for (const key of Object.keys(STAT_LABELS)) {
    const text = fmtStat(key, stats[key] || 0);
    if (text) out.push(text);
  }
  return out;
}

let _nextId = 1;
function item(defId, name, slot, rarity, level, stats, opts = {}) {
  return {
    id: `sample-${_nextId++}`,
    defId,
    name,
    slot,
    rarity,
    level,
    setId: opts.setId || null,
    equippedByOwnerIds: opts.equippedHeroId ? [opts.equippedHeroId] : [],
    rawStats: stats,
    stats: nonzeroStats(stats),
  };
}

const SAMPLE_HEROES = [
  { id: "hero-1", name: "Aelindra" },
  { id: "hero-2", name: "Borin Stonefist" },
  { id: "hero-3", name: "Kestrel" },
];

const SAMPLE_EQUIPMENT = [
  // --- Beastlord's Hunt set (4 pieces total, only 3 tracked here — no boots owned) ---
  item("beastfang_dagger", "Beastfang Dagger", "WEAPON", "RARE", 12,
    { attack: 8600, defense: 1200, health: 9400 }, { setId: "beast" }),
  item("wolfhide_vest", "Wolfhide Vest", "ARMOR", "RARE", 10,
    { attack: 2100, defense: 7400, health: 15200 }, { setId: "beast", equippedHeroId: "hero-1" }),
  item("trackers_hood", "Tracker's Hood", "HELM", "RARE", 9,
    { attack: 1800, defense: 5200, health: 11000 }, { setId: "beast" }),

  // --- Prospector's Kit set (3 pieces total, all 3 owned) ---
  item("uncommon_miners_pick", "Miner's Pick", "WEAPON", "UNCOMMON", 8,
    { attack: 12841, defense: 2338, health: 18300, gatherSpeedStone: 0.026 }, { setId: "gatherers" }),
  item("uncommon_miners_pick", "Miner's Pick", "WEAPON", "UNCOMMON", 4,
    { attack: 10677, defense: 1944, health: 15216, gatherSpeedStone: 0.026 }, { setId: "gatherers" }),
  item("master_miners_helm", "Master Miner's Helm", "HELM", "UNCOMMON", 6,
    { attack: 3900, defense: 4100, health: 12800, gatherSpeedStone: 0.02 }, { setId: "gatherers" }),
  item("uncommon_merchants_pouch", "Merchant's Pouch", "ACCESSORY", "UNCOMMON", 9,
    { attack: 7704, defense: 4877, health: 38145, gatherSpeedGold: 0.026 }, { setId: "gatherers", equippedHeroId: "hero-2" }),

  // --- Conqueror's Regalia set (6 pieces total, all 6 owned) ---
  item("conquerors_pendant", "Conqueror's Pendant", "ACCESSORY", "EPIC", 15,
    { attack: 9800, defense: 3400, health: 12200 }, { setId: "conqueror" }),
  item("conquerors_shroud", "Conqueror's Shroud", "ARMOR", "EPIC", 15,
    { attack: 3200, defense: 11800, health: 24500 }, { setId: "conqueror" }),
  item("conquerors_cowl", "Conqueror's Cowl", "HELM", "EPIC", 15,
    { attack: 8100, defense: 6200, health: 15800 }, { setId: "conqueror" }),
  item("conquerors_stalkers", "Conqueror's Stalkers", "BOOTS", "EPIC", 15,
    { attack: 4600, defense: 5400, health: 13900, marchSpeed: 0.04 }, { setId: "conqueror" }),
  item("conquerors_fang", "Conqueror's Fang", "WEAPON", "LEGENDARY", 18,
    { attack: 21400, defense: 3800, health: 14200 }, { setId: "conqueror", equippedHeroId: "hero-3" }),
  item("conquerors_signet", "Conqueror's Signet", "RING", "LEGENDARY", 18,
    { attack: 12600, defense: 8200, health: 26400 }, { setId: "conqueror" }),

  // --- Warden's Vigil set (6 pieces total, all 6 owned) ---
  item("wardens_greaves", "Warden's Greaves", "BOOTS", "EPIC", 15,
    { attack: 4100, defense: 7200, health: 16800, marchSpeed: 0.03 }, { setId: "warden" }),
  item("wardens_wardsword", "Warden's Wardsword", "WEAPON", "EPIC", 15,
    { attack: 11200, defense: 4600, health: 13400 }, { setId: "warden" }),
  item("wardens_bulwark", "Warden's Bulwark", "ACCESSORY", "EPIC", 15,
    { attack: 3800, defense: 9400, health: 19600 }, { setId: "warden" }),
  item("wardens_band", "Warden's Band", "RING", "EPIC", 15,
    { attack: 6200, defense: 8800, health: 21200 }, { setId: "warden" }),
  item("wardens_aegis", "Warden's Aegis", "ARMOR", "LEGENDARY", 18,
    { attack: 5400, defense: 19200, health: 38600 }, { setId: "warden" }),
  item("wardens_greathelm", "Warden's Greathelm", "HELM", "LEGENDARY", 18,
    { attack: 7800, defense: 16400, health: 31200 }, { setId: "warden" }),

  // --- Ungrouped items, filling out the remaining slots ---
  item("rare_boots", "Swiftstriders", "BOOTS", "RARE", 11,
    { attack: 4200, defense: 6900, health: 14500, marchSpeed: 0.06 }),
  item("common_boots", "Leather Boots", "BOOTS", "COMMON", 5,
    { attack: 900, defense: 1400, health: 5200 }),
  item("epic_ring", "Arcane Sigil", "RING", "EPIC", 14,
    { attack: 15400, defense: 3200, health: 9800, pvpDamageMultiplier: 0.04 }),
  item("uncommon_ring", "Silver Band", "RING", "UNCOMMON", 4,
    { attack: 7614, defense: 6104, health: 22379, gatherSpeed: 0.006 }),
  item("rare_sword", "Knight's Longsword", "WEAPON", "RARE", 13,
    { attack: 19200, defense: 2600, health: 11400, firstRoundDamage: 0.05 }),
  item("epic_helm", "Prospector's Warcrown", "HELM", "EPIC", 15,
    { attack: 9200, defense: 12400, health: 28900, gatherSpeed: 0.03 }, { equippedHeroId: "hero-3" }),
  item("rare_amulet", "Gold Talisman", "ACCESSORY", "RARE", 10,
    { attack: 5400, defense: 3100, health: 16200, gatherSpeedFood: 0.02 }),
  item("epic_amulet", "Merchant's Voidstone", "ACCESSORY", "EPIC", 16,
    { attack: 6100, defense: 4400, health: 21000, pvpDefense: 0.03 }),
  item("rare_armor", "Plate Armor", "ARMOR", "RARE", 12,
    { attack: 3400, defense: 15200, health: 32100 }),
];

const SAMPLE_KNOWN_SET_SIZES = { beast: 4, gatherers: 3, conqueror: 6, warden: 6 };
