/**
 * The PvP shop's gear catalogue — the twelve pieces buyable for Valor, and the
 * arithmetic for "what would this actually be worth in that slot".
 *
 * Transcribed from the shop's own item detail cards (2026-08-16, all twelve
 * captured). Everything here is read off those cards rather than derived, with
 * two exceptions noted against the constants below.
 *
 * Every piece sells at level 1 with fixed core stats (see
 * PVP_SHOP_ARRIVAL_LEVEL), which is what makes a buy plan computable at all:
 * there is no roll to guess on. What each copy DOES roll is its random affixes
 * (3 on an Epic, 4 on a Legendary, drawn from a per-piece theme), and those are
 * deliberately left out of scoring; see PVP_SHOP_AFFIXES_UNSCORED.
 *
 * A bought piece is therefore worth what the piece you scrap into it can buy —
 * the plan's job is to say which of those trades is worth the Valor.
 */

/** What the shop charges in. */
const PVP_SHOP_CURRENCY = "Valor";

/** The stat numbers below are the card's own, and the card rounds to whole
 * thousands — "+28K", never "+28,431". So every core stat here carries up to
 * ±500 of transcription error, which is under 1% on a health roll and up to 8%
 * on a small defence one (Conqueror's Fang reads +4K).
 *
 * It doesn't distort the ranking the way it looks like it might. Rows are
 * ranked on a whole loadout's score, health dominates that sum by an order of
 * magnitude on every piece here, and the two pieces whose small stats are
 * roundest are both weapons — which win or lose on attack, not defence. */
const PVP_SHOP_STATS_ROUNDED_TO = 1000;

/** A piece bought from the shop is a LEVEL 1 item. Its card quotes level-1
 * stats, and it arrives at level 1 — one fact, and the constant both the stat
 * projection and the XP pool start from.
 *
 * The listing's "Epic · Lv 15" made the shop level the natural reading of both.
 * Two independent lines of evidence say otherwise:
 *
 *   STATS. Twenty-six of these pieces are owned across the exports in
 *   csv-exports/, at levels 20 to 40 and in both rarities. Every one is
 *   consistent with the level-1 reading once the card's ±500 rounding is
 *   allowed for (see PVP_SHOP_STATS_ROUNDED_TO) and quality is taken out — a
 *   quality roll scales the core stats by 1 + quality% x 0.25, so a 37%-quality
 *   copy reads 9% above its zero-quality twin. As a percentage the residual
 *   tracks the size of the stat, not the quality of the fit: within 3% on every
 *   health reading, and up to 11.9% on Warden's Wardsword defence, whose card
 *   rounds ~3,522 to "+4K". Read instead as level-15/18 stats the same pieces
 *   come out 43-52% short, with no overlap between the error bands.
 *
 *   LANDED LEVELS. With the scrap formula known (SCRAP_XP_PER_LEVEL), the
 *   levels these pieces actually sit at only work from a level-1 start. One
 *   player's five bought pieces are all Epics at Lv 20, which needs
 *   8,281-9,144 XP; an Epic Lv 14 scrap pays 8,400. Another player's three
 *   Epics at Lv 22 need 10,076-11,082; an Epic Lv 17 pays 10,200. From level 15
 *   the same scraps overshoot by four levels and more.
 *
 * A third line — that same-level clusters spanning both rarities prove a common
 * starting point — was considered and does NOT hold, which is worth recording
 * so it isn't re-derived. That player's other two Lv-22 pieces are Legendary,
 * and a Legendary needs 16,127 XP to reach Lv 22 against an Epic's 10,076. So
 * an equal landing level across rarities requires UNEQUAL scrap (a Legendary
 * Lv 17 or Epic Lv 27 would do it), not comparable scrap from a shared start:
 * poured the same 10,200, an Epic lands at Lv 22 and a Legendary at Lv 17. The
 * clusters are real and consistent with level-1 arrival; they just aren't
 * evidence for it, because they are equally consistent with any shared start.
 *
 * What "Lv 15" on the listing then means is unconfirmed — most likely the
 * account level needed to buy the piece. It's kept as listedLevel below because
 * it is a real number off the screen, but nothing computes with it. */
const PVP_SHOP_ARRIVAL_LEVEL = 1;

/** What each theme's affix slots can roll, verbatim from the cards. Recorded
 * because the two lists are DISJOINT, and that's easy to lose sight of once
 * the numbers are in a table:
 *
 *   PvP Offense (Conqueror) — March Speed, Army Attack, Infantry Attack,
 *     Archer Attack, Cavalry Attack, First Round Damage
 *   PvP Defense (Warden)    — Army Defense, Army Health, Infantry Defense,
 *     Infantry Health, Archer Defense, Archer Health, Cavalry Defense,
 *     Cavalry Health
 *
 * The trap is Health. A Conqueror piece carries flat Health in its guaranteed
 * Stats block and can NEVER roll a health affix; a Warden piece can roll "Army
 * Health", which is a percentage troop buff and a different stat entirely from
 * the flat Health both sets carry. Reading the flat Health on a Conqueror card
 * as a possible roll gets the piece backwards. */
const PVP_AFFIX_POOLS = {
  "PvP Offense": [
    "March Speed", "Army Attack", "Infantry Attack",
    "Archer Attack", "Cavalry Attack", "First Round Damage",
  ],
  "PvP Defense": [
    "Army Defense", "Army Health", "Infantry Defense", "Infantry Health",
    "Archer Defense", "Archer Health", "Cavalry Defense", "Cavalry Health",
  ],
};

/** Every piece rolls random affixes on purchase (3 on an Epic, 4 on a
 * Legendary) from the theme named on its card. They are real value and they
 * are deliberately NOT scored: which stats land, and how big, is unknown until
 * the piece is in your hands, so any number put on them would be invented.
 *
 * The `stats` block in the catalogue below is the OTHER thing on the card —
 * the guaranteed base, fixed per definition and identical on every copy, which
 * is what the panel scores. The cross-check that proves the two are different
 * in kind: both Epic accessories read 16K/7K/49K and both Epic boots 9K/7K/68K
 * across the two sets, which cannot happen if those were per-copy rolls.
 *
 * They're shown on each row instead. The bias they introduce is uniform in
 * direction — every row is understated — and nearly uniform in size within a
 * rarity, so the ORDER survives it even though the absolute gains don't. Where
 * it does tilt: a Legendary rolls a fourth affix an Epic doesn't, so a close
 * Epic-over-Legendary row is closer than it reads. */
const PVP_SHOP_AFFIXES_UNSCORED = true;

/** Quality is the SECOND thing a purchase rolls that no row scores, and it's
 * left out for the same reason: it isn't known until the piece is bought.
 *
 * Recorded separately because it is bigger than the card's rounding and easy to
 * mistake for it. Quality scales the core stats by
 *
 *     1 + quality_percent / 100 x 0.25
 *
 * measured off the owned copies in csv-exports/ — the same definition at the
 * same level differs by exactly that factor between a 0%-quality copy and a
 * rolled one, holding to a tenth of a percent across attack, defence and health
 * on every pair (37% quality reads +9.2%, 13% reads +3.2%, 3% reads +0.75%).
 *
 * Same direction as the affixes, so it deepens the same understatement rather
 * than pulling against it. It doesn't distort the ORDER either, for a different
 * reason: quality is rolled per copy and independent of which piece you buy, so
 * it's an unbiased offset across rows rather than something favouring one. */
const PVP_SHOP_QUALITY_UNSCORED = true;

/**
 * The catalogue. `defId` matches the game's own equipment_definition_id (the
 * same keys csv-import.js maps to sets), so a piece already in your export can
 * be recognised rather than recommended twice.
 *
 * `stats` are raw item values in the same units as an imported item's
 * rawStats: flat for attack/defense/health, fraction-of-one for percentages
 * (+1.0% is 0.01).
 */
const PVP_SHOP_ITEMS = [
  // --- Conqueror's Regalia — PvP Offense theme, set bonus is PvP Attack ---
  {
    defId: "conqueror_amulet", name: "Conqueror's Pendant", slot: "ACCESSORY",
    rarity: "EPIC", listedLevel: 15, maxLevel: 37, cost: 5000, setId: "conqueror",
    affixSlots: 3, affixTheme: "PvP Offense",
    stats: { attack: 16000, defense: 7000, health: 49000, pvpAttack: 0.01 },
  },
  {
    defId: "conqueror_plate", name: "Conqueror's Shroud", slot: "ARMOR",
    rarity: "EPIC", listedLevel: 15, maxLevel: 37, cost: 5000, setId: "conqueror",
    affixSlots: 3, affixTheme: "PvP Offense",
    stats: { attack: 5000, defense: 18000, health: 74000, pvpAttack: 0.01 },
  },
  {
    defId: "conqueror_helm", name: "Conqueror's Cowl", slot: "HELM",
    rarity: "EPIC", listedLevel: 15, maxLevel: 37, cost: 5000, setId: "conqueror",
    affixSlots: 3, affixTheme: "PvP Offense",
    stats: { attack: 10000, defense: 14000, health: 62000, pvpAttack: 0.01 },
  },
  {
    defId: "conqueror_boots", name: "Conqueror's Stalkers", slot: "BOOTS",
    rarity: "EPIC", listedLevel: 15, maxLevel: 37, cost: 5000, setId: "conqueror",
    affixSlots: 3, affixTheme: "PvP Offense",
    stats: { attack: 9000, defense: 7000, health: 68000, marchSpeed: 0.04, pvpAttack: 0.01 },
  },
  {
    defId: "conqueror_blade", name: "Conqueror's Fang", slot: "WEAPON",
    rarity: "LEGENDARY", listedLevel: 18, maxLevel: 40, cost: 12000, setId: "conqueror",
    affixSlots: 4, affixTheme: "PvP Offense",
    stats: { attack: 32000, defense: 4000, health: 34000, pvpAttack: 0.02 },
  },
  {
    defId: "conqueror_ring", name: "Conqueror's Signet", slot: "RING",
    rarity: "LEGENDARY", listedLevel: 18, maxLevel: 40, cost: 12000, setId: "conqueror",
    affixSlots: 4, affixTheme: "PvP Offense",
    stats: { attack: 19000, defense: 10000, health: 43000, pvpAttack: 0.02 },
  },

  // --- Warden's Vigil — PvP Defense theme, set bonus is PvP Defense ---
  {
    defId: "warden_blade", name: "Warden's Wardsword", slot: "WEAPON",
    rarity: "EPIC", listedLevel: 15, maxLevel: 37, cost: 5000, setId: "warden",
    affixSlots: 3, affixTheme: "PvP Defense",
    stats: { attack: 28000, defense: 4000, health: 25000, pvpDefense: 0.01 },
  },
  {
    defId: "warden_amulet", name: "Warden's Bulwark", slot: "ACCESSORY",
    rarity: "EPIC", listedLevel: 15, maxLevel: 37, cost: 5000, setId: "warden",
    affixSlots: 3, affixTheme: "PvP Defense",
    stats: { attack: 16000, defense: 7000, health: 49000, pvpDefense: 0.01 },
  },
  {
    defId: "warden_ring", name: "Warden's Band", slot: "RING",
    rarity: "EPIC", listedLevel: 15, maxLevel: 37, cost: 5000, setId: "warden",
    affixSlots: 3, affixTheme: "PvP Defense",
    stats: { attack: 17000, defense: 9000, health: 31000, pvpDefense: 0.01 },
  },
  {
    defId: "warden_greaves", name: "Warden's Greaves", slot: "BOOTS",
    rarity: "EPIC", listedLevel: 15, maxLevel: 37, cost: 5000, setId: "warden",
    affixSlots: 3, affixTheme: "PvP Defense",
    stats: { attack: 9000, defense: 7000, health: 68000, pvpDefense: 0.01 },
  },
  {
    defId: "warden_aegis", name: "Warden's Aegis", slot: "ARMOR",
    rarity: "LEGENDARY", listedLevel: 18, maxLevel: 40, cost: 12000, setId: "warden",
    affixSlots: 4, affixTheme: "PvP Defense",
    stats: { attack: 6000, defense: 19000, health: 103000, pvpDefense: 0.02 },
  },
  {
    defId: "warden_helm", name: "Warden's Greathelm", slot: "HELM",
    rarity: "LEGENDARY", listedLevel: 18, maxLevel: 40, cost: 12000, setId: "warden",
    affixSlots: 4, affixTheme: "PvP Defense",
    stats: { attack: 12000, defense: 15000, health: 86000, pvpDefense: 0.02 },
  },
];

/**
 * What a shop piece would actually be, dropped into a slot whose current
 * occupant is scrapped to feed it — returned in the same shape as an imported
 * item so every scorer in the app can read it without a special case.
 *
 * The level it lands at is the whole reason this isn't a stat comparison. The
 * replacement does NOT arrive at the level of the piece it replaces: it starts
 * at level 1 and climbs on its OWN rarity's cost curve, which for a Legendary
 * is 1.6x an Epic's per level. Scrapping a level-30 Epic into a Legendary buys
 * fewer levels than the Epic had — and usually wins anyway, because the
 * Legendary's level-1 stats are far higher. Both effects are real and they
 * point opposite ways, so neither can be eyeballed.
 *
 * The two curves in play pull against each other here as well: the scrap pays a
 * FLAT rate per level of the piece consumed, and those levels are bought back
 * on a curve that compounds. A high-level scrap is worth proportionally less
 * than it looks.
 *
 * `current` may be null (an empty slot) — then there's no XP to inherit and the
 * piece is simply what the shop sells, at level 1.
 */
function pvpReplacementItem(shopItem, current) {
  const pool = scrapXpFromItem(current);
  const landed = levelFromXpPool(
    shopItem.rarity, pool, PVP_SHOP_ARRIVAL_LEVEL, shopItem.maxLevel,
  );
  const rawStats = projectStatsToLevel(shopItem.stats, PVP_SHOP_ARRIVAL_LEVEL, landed.level);

  return {
    id: `pvp-shop:${shopItem.defId}`,
    defId: shopItem.defId,
    name: shopItem.name,
    slot: shopItem.slot,
    rarity: shopItem.rarity,
    level: landed.level,
    maxLevel: shopItem.maxLevel,
    setId: shopItem.setId,
    quality: null,
    equippedByOwnerIds: [],
    rawStats,
    stats: nonzeroStats(rawStats),
    // What the shop transaction itself looked like, for the row to explain.
    shopItem,
    xpInherited: pool,
    xpWasted: landed.xpWasted,
    levelsFromXp: landed.level - PVP_SHOP_ARRIVAL_LEVEL,
  };
}
