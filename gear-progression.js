/**
 * How a piece of gear grows when you enhance it — the level curve, the XP
 * curve, and the projection of an item's stats to its level cap.
 *
 * Everything here was reverse-engineered from the game's own numbers (item
 * detail screens plus a 188-item CSV export) rather than published anywhere,
 * so the evidence is recorded alongside each constant. Two independent curves
 * are at work and they pull in opposite directions:
 *
 *   stats grow LINEARLY   — every level adds the same flat amount
 *   XP costs grow 8%/level — so each level costs 1.08x the one before
 *
 * Which is the whole reason a "level this to max" plan is worth computing at
 * all: the value of a level is constant while its price compounds, so
 * enhancement efficiency halves every 9 levels (1.08^9 = 2.00) and the right
 * next level to buy is rarely on the item you'd guess.
 */

/** Fraction of an item's LEVEL 1 core stats added by each level beyond the
 * first, so an item at level L carries 1 + LEVEL_STAT_STEP * (L - 1) times its
 * level-1 stats.
 *
 * Linear, not compounding. Forager's Cuirass at 0% quality reads 67,047 /
 * 70,444 / 73,841 health at levels 4 / 5 / 6 — a flat +3,397 a level — and
 * levels 8, 13 and 20 sit on the same straight line. Fitting the step across
 * every multi-level definition in the export gives 0.059746 with a spread of
 * 0.0002 (the outliers are all short level spans, where rounding the displayed
 * quality to a whole percent dominates). Deliberately NOT 0.06: the zero-
 * quality items carry no rounding error at all and pin it tightly enough that
 * 0.06 sits well outside the range. */
const LEVEL_STAT_STEP = 0.059745;

/** Only these three scale with level. Every percentage affix — march speed,
 * troop buffs, gathering, PvP — is a fixed roll made when the item drops and
 * does not move when you enhance it: epic_boots carries march speed 0.055 at
 * level 9 and 0.055 at level 37, Pathfinder's Blade 0.090 from level 5 to 21.
 * Scaling those alongside the core stats would have inflated that same march
 * speed to 0.117 and handed the optimizer a loadout built on stats the item
 * will never have. */
const LEVEL_SCALED_STAT_KEYS = new Set(["attack", "defense", "health"]);

/** Level cap by rarity — 25 + 3 x tier, confirmed against the game's own
 * per-rarity table (2026-08-16). Used only when an item has no max_level of its
 * own (older backups, sample data); the CSV export carries the real value per
 * item and that always wins. */
const MAX_LEVEL_BY_RARITY = {
  COMMON: 28,
  UNCOMMON: 31,
  RARE: 34,
  EPIC: 37,
  LEGENDARY: 40,
};

/** XP to get from a level to the next one is
 *
 *     floor(XP_BASE_BY_RARITY[rarity] * XP_GROWTH^(level - 1))
 *
 * CONFIRMED against the game's own formula and per-rarity table (2026-08-16),
 * which agree with all seven constants below exactly. Treat them as given, not
 * as a fit to be revisited when a number looks surprising. The fit that got us
 * here is kept because it says what the constants are worth independently of
 * that source:
 *
 * Fitted against 10 readings spanning all five rarities and levels 2-19, every
 * one of which it reproduces exactly: common L2 43, L4 50, L5 54, L6 58;
 * uncommon L15 205, L19 279; rare L16 380, L18 444; epic L19 799; legendary
 * L14 870. Solving the inequalities leaves the growth rate in [1.0800, 1.0801],
 * so 1.08 is the literal constant rather than a fit. It floors rather than
 * rounds — common L6 computes to 58.77 and the game shows 58.
 *
 * The bases are the only thing rarity changes, and they step 30 / 50 / 80 / 120
 * apart. A legendary therefore costs 8x a common for the SAME level, which is
 * worth exactly 27 levels of headroom (ln 8 / ln 1.08) — a legendary's first
 * level costs more than a common's last. */
const XP_BASE_BY_RARITY = {
  COMMON: 40,
  UNCOMMON: 70,
  RARE: 120,
  EPIC: 200,
  LEGENDARY: 320,
};
const XP_GROWTH = 1.08;

/** What an item's core stats are multiplied by at this level. */
function levelStatMultiplier(level) {
  const lv = Number(level) || 1;
  return 1 + LEVEL_STAT_STEP * (lv - 1);
}

/** The level this item can be enhanced to. Prefers the item's own maxLevel
 * (the CSV export has one per item), falls back to the rarity table, and as a
 * last resort treats the current level as the cap so an item of unknown rarity
 * projects to itself instead of to nonsense. */
function maxLevelForItem(item) {
  if (!item) return 0;
  if (Number.isFinite(item.maxLevel) && item.maxLevel > 0) return item.maxLevel;
  const byRarity = MAX_LEVEL_BY_RARITY[String(item.rarity || "").toUpperCase()];
  return byRarity || Number(item.level) || 0;
}

/** XP to go from `level` to `level + 1`. Zero for anything without a known
 * rarity base, so an unrecognised item contributes no phantom cost to a plan. */
function xpForNextLevel(rarity, level) {
  const base = XP_BASE_BY_RARITY[String(rarity || "").toUpperCase()];
  if (!base) return 0;
  const lv = Number(level) || 1;
  return Math.floor(base * Math.pow(XP_GROWTH, lv - 1));
}

/** Total XP to enhance from `fromLevel` up to `toLevel`. */
function xpBetweenLevels(rarity, fromLevel, toLevel) {
  let total = 0;
  for (let lv = Number(fromLevel) || 1; lv < (Number(toLevel) || 0); lv++) {
    total += xpForNextLevel(rarity, lv);
  }
  return total;
}

/** XP handed over when an item is SACRIFICED to enhance another one:
 *
 *     SCRAP_XP_PER_LEVEL[rarity] * level
 *
 * Flat per level — and that is the surprise. Levelling an item costs a curve
 * that compounds at 8%, but scrapping it back pays a straight line, so the two
 * directions are NOT inverses of each other and neither can stand in for the
 * other. Nothing recovers a percentage of what went in: a low-level piece hands
 * back far more than it cost, a near-capped one far less, and the crossover
 * sits around level 24 for every rarity.
 *
 * Read straight off the game's own sacrifice screen (2026-08-16): 92 readings
 * spanning all five rarities and levels 2-30, of which 88 land on
 * rarity x level to the XP. The four that don't are all SHORT by nothing and
 * OVER by a little — +39, +101, +158, +179 — which is XP already banked toward
 * the item's next level riding along with it. The CSV export carries no partial
 * XP, so that residual is invisible here and this necessarily under-states a
 * part-levelled piece by less than one level's worth.
 *
 * Legendary really is 1000 and not the 1200 the other four would predict —
 * doubling holds from Uncommon to Epic and then stops. Three readings, two
 * items, two levels: Immortal Aegis Lv 9 -> 9,000, Kingsward Lv 9 -> 9,000,
 * Warden's Aegis Lv 22 -> 22,000.
 *
 * That last one also settles how a shop-bought piece is valued. Warden's Aegis
 * comes from the PvP shop with levels it never paid XP for, and it still pays
 * exactly 1000 x level. So this is a function of rarity and level ALONE — how
 * the item reached that level buys it no discount and no premium. */
const SCRAP_XP_PER_LEVEL = {
  COMMON: 100,
  UNCOMMON: 150,
  RARE: 300,
  EPIC: 600,
  LEGENDARY: 1000,
};

/** The XP pool a replacement inherits when this piece is fed to it. */
function scrapXpFromItem(item) {
  if (!item) return 0;
  const perLevel = SCRAP_XP_PER_LEVEL[String(item.rarity || "").toUpperCase()];
  if (!perLevel) return 0;
  return perLevel * (Number(item.level) || 1);
}

/** The level a piece of `rarity` starting at `fromLevel` reaches on a pool of
 * `xp`, and what the pool couldn't buy.
 *
 * Rarity is the whole point of this being a walk rather than a division: the
 * pool was earned on one rarity's cost curve and gets spent on another's, and
 * the curve compounds at 8% a level, so where on it you START changes what the
 * same XP buys. A legendary's base is 8x a common's — the same XP that took an
 * epic from 1 to 25 moves a legendary far less far, and moves it less again
 * for beginning at level 18 rather than 1.
 *
 * Clamped at the cap, with the overflow reported rather than silently dropped:
 * a big pool poured into a piece near its ceiling strands most of itself, and
 * a plan that hid that would be recommending a real loss. */
function levelFromXpPool(rarity, xp, fromLevel, maxLevel) {
  const cap = Number(maxLevel) || MAX_LEVEL_BY_RARITY[String(rarity || "").toUpperCase()] || 1;
  let level = Math.max(1, Number(fromLevel) || 1);
  let spent = 0;
  while (level < cap) {
    const cost = xpForNextLevel(rarity, level);
    if (!cost || spent + cost > xp) break;
    spent += cost;
    level += 1;
  }
  return { level, xpSpent: spent, xpWasted: level >= cap ? Math.max(0, xp - spent) : 0 };
}

/** The same stat dict as it would read at `toLevel`.
 *
 * Quality never enters this: it's a multiplier the item has already had
 * applied and it's identical at both ends, so it cancels in the ratio. That
 * means a projection needs nothing but the two levels — no base stats, no
 * quality roll, no per-item lookup — and stays exact for an item whose quality
 * the app never saw. Non-core keys are copied through untouched. */
function projectStatsToLevel(rawStats, fromLevel, toLevel) {
  const from = levelStatMultiplier(fromLevel);
  const to = levelStatMultiplier(toLevel);
  const ratio = from > 0 ? to / from : 1;
  const out = {};
  for (const [key, value] of Object.entries(rawStats || {})) {
    out[key] = LEVEL_SCALED_STAT_KEYS.has(key) ? value * ratio : value;
  }
  return out;
}

/** An item's stats at its level cap, plus what getting there costs. Returns
 * `levelsToGo: 0` and the item's own stats for anything already maxed. */
function projectItemToMaxLevel(item) {
  const maxLevel = maxLevelForItem(item);
  const level = Number(item && item.level) || 0;
  const levelsToGo = Math.max(0, maxLevel - level);
  return {
    maxLevel,
    levelsToGo,
    xpToMax: levelsToGo ? xpBetweenLevels(item.rarity, level, maxLevel) : 0,
    stats: levelsToGo
      ? projectStatsToLevel(item.rawStats, level, maxLevel)
      : { ...(item.rawStats || {}) },
  };
}
