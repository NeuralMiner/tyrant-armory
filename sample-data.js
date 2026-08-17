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
    quality: opts.quality ?? null,
    setId: opts.setId || null,
    equippedByOwnerIds: opts.equippedHeroId ? [opts.equippedHeroId] : [],
    rawStats: stats,
    stats: nonzeroStats(stats),
  };
}

/** rarity picks the breakpoint curve that turns these heroes' flat
 * Attack/Defence/Health into a troop buff (see hero-breakpoints.js).
 * statTotals is what the hero card would read; equippedGearTotals is how much
 * of that the gear already on them accounts for, which is what lets the app
 * work out what a different loadout would give. Zero here — these sample
 * heroes are treated as unequipped, so their totals ARE their gearless base.
 * Made-up numbers like the rest of the sample data, but placed mid-curve so
 * the flat-vs-percentage trade-off is visible before real gear is loaded. */
const SAMPLE_HEROES = [
  { id: "hero-1", name: "Aelindra", rarity: "EPIC",
    statTotals: { attack: 302000, defense: 148000, health: 1210000 },
    equippedGearTotals: { attack: 0, defense: 0, health: 0 } },
  { id: "hero-2", name: "Borin Stonefist", rarity: "RARE",
    statTotals: { attack: 118000, defense: 284000, health: 1094000 },
    equippedGearTotals: { attack: 0, defense: 0, health: 0 } },
  { id: "hero-3", name: "Kestrel", rarity: "LEGENDARY",
    statTotals: { attack: 617000, defense: 176000, health: 2140000 },
    equippedGearTotals: { attack: 0, defense: 0, health: 0 } },
];

const SAMPLE_EQUIPMENT = [
  // --- Beastlord's Hunt set (4 pieces total, only 3 tracked here — no boots owned) ---
  item("beastfang_dagger", "Beastfang Dagger", "WEAPON", "RARE", 12,
    { attack: 8600, defense: 1200, health: 9400 }, { setId: "beast", quality: 78 }),
  item("wolfhide_vest", "Wolfhide Vest", "ARMOR", "RARE", 10,
    { attack: 2100, defense: 7400, health: 15200 }, { setId: "beast", equippedHeroId: "hero-1", quality: 64 }),
  item("trackers_hood", "Tracker's Hood", "HELM", "RARE", 9,
    { attack: 1800, defense: 5200, health: 11000 }, { setId: "beast", quality: 71 }),

  // --- Prospector's Kit set (3 pieces total, all 3 owned) ---
  item("uncommon_miners_pick", "Miner's Pick", "WEAPON", "UNCOMMON", 8,
    { attack: 12841, defense: 2338, health: 18300, gatherSpeedStone: 0.026 }, { setId: "gatherers", quality: 52 }),
  item("uncommon_miners_pick", "Miner's Pick", "WEAPON", "UNCOMMON", 4,
    { attack: 10677, defense: 1944, health: 15216, gatherSpeedStone: 0.026 }, { setId: "gatherers", quality: 41 }),
  item("master_miners_helm", "Master Miner's Helm", "HELM", "UNCOMMON", 6,
    { attack: 3900, defense: 4100, health: 12800, gatherSpeedStone: 0.02 }, { setId: "gatherers", quality: 58 }),
  item("uncommon_merchants_pouch", "Merchant's Pouch", "ACCESSORY", "UNCOMMON", 9,
    { attack: 7704, defense: 4877, health: 38145, gatherSpeedGold: 0.026 }, { setId: "gatherers", equippedHeroId: "hero-2", quality: 67 }),

  // --- Conqueror's Regalia set (6 pieces total, all 6 owned) ---
  item("conquerors_pendant", "Conqueror's Pendant", "ACCESSORY", "EPIC", 15,
    { attack: 9800, defense: 3400, health: 12200 }, { setId: "conqueror", quality: 83 }),
  item("conquerors_shroud", "Conqueror's Shroud", "ARMOR", "EPIC", 15,
    { attack: 3200, defense: 11800, health: 24500 }, { setId: "conqueror", quality: 88 }),
  item("conquerors_cowl", "Conqueror's Cowl", "HELM", "EPIC", 15,
    { attack: 8100, defense: 6200, health: 15800 }, { setId: "conqueror", quality: 79 }),
  item("conquerors_stalkers", "Conqueror's Stalkers", "BOOTS", "EPIC", 15,
    { attack: 4600, defense: 5400, health: 13900, marchSpeed: 0.04 }, { setId: "conqueror", quality: 85 }),
  item("conquerors_fang", "Conqueror's Fang", "WEAPON", "LEGENDARY", 18,
    { attack: 21400, defense: 3800, health: 14200 }, { setId: "conqueror", equippedHeroId: "hero-3", quality: 94 }),
  item("conquerors_signet", "Conqueror's Signet", "RING", "LEGENDARY", 18,
    { attack: 12600, defense: 8200, health: 26400 }, { setId: "conqueror", quality: 91 }),

  // --- Warden's Vigil set (6 pieces total, all 6 owned) ---
  item("wardens_greaves", "Warden's Greaves", "BOOTS", "EPIC", 15,
    { attack: 4100, defense: 7200, health: 16800, marchSpeed: 0.03 }, { setId: "warden", quality: 76 }),
  item("wardens_wardsword", "Warden's Wardsword", "WEAPON", "EPIC", 15,
    { attack: 11200, defense: 4600, health: 13400 }, { setId: "warden", quality: 82 }),
  item("wardens_bulwark", "Warden's Bulwark", "ACCESSORY", "EPIC", 15,
    { attack: 3800, defense: 9400, health: 19600 }, { setId: "warden", quality: 80 }),
  item("wardens_band", "Warden's Band", "RING", "EPIC", 15,
    { attack: 6200, defense: 8800, health: 21200 }, { setId: "warden", quality: 74 }),
  item("wardens_aegis", "Warden's Aegis", "ARMOR", "LEGENDARY", 18,
    { attack: 5400, defense: 19200, health: 38600 }, { setId: "warden", quality: 96 }),
  item("wardens_greathelm", "Warden's Greathelm", "HELM", "LEGENDARY", 18,
    { attack: 7800, defense: 16400, health: 31200 }, { setId: "warden", quality: 90 }),

  // --- Ungrouped items, filling out the remaining slots ---
  item("rare_boots", "Swiftstriders", "BOOTS", "RARE", 11,
    { attack: 4200, defense: 6900, health: 14500, marchSpeed: 0.06 }, { quality: 69 }),
  item("common_boots", "Leather Boots", "BOOTS", "COMMON", 5,
    { attack: 900, defense: 1400, health: 5200 }, { quality: 33 }),
  item("epic_ring", "Arcane Sigil", "RING", "EPIC", 14,
    { attack: 15400, defense: 3200, health: 9800, pvpDamageMultiplier: 0.04 }, { quality: 87 }),
  item("uncommon_ring", "Silver Band", "RING", "UNCOMMON", 4,
    { attack: 7614, defense: 6104, health: 22379, gatherSpeed: 0.006 }, { quality: 45 }),
  item("rare_sword", "Knight's Longsword", "WEAPON", "RARE", 13,
    { attack: 19200, defense: 2600, health: 11400, firstRoundDamage: 0.05 }, { quality: 72 }),
  item("epic_helm", "Prospector's Warcrown", "HELM", "EPIC", 15,
    { attack: 9200, defense: 12400, health: 28900, gatherSpeed: 0.03 }, { equippedHeroId: "hero-3", quality: 81 }),
  item("rare_amulet", "Gold Talisman", "ACCESSORY", "RARE", 10,
    { attack: 5400, defense: 3100, health: 16200, gatherSpeedFood: 0.02 }, { quality: 66 }),
  item("epic_amulet", "Merchant's Voidstone", "ACCESSORY", "EPIC", 16,
    { attack: 6100, defense: 4400, health: 21000, pvpDefense: 0.03 }, { quality: 84 }),
  item("rare_armor", "Plate Armor", "ARMOR", "RARE", 12,
    { attack: 3400, defense: 15200, health: 32100 }, { quality: 70 }),
];

const SAMPLE_KNOWN_SET_SIZES = { beast: 4, gatherers: 3, conqueror: 6, warden: 6 };
