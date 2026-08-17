/**
 * HERO STAT BREAKPOINTS — converting raw Attack/Defence/Health into the troop
 * buff percentage the game actually grants.
 *
 * A hero's raw Attack/Defence/Health stat is NOT the buff it gives your troops.
 * The game runs it through a diminishing-returns curve that ends in a hard cap
 * set by the hero's rarity. Two heroes with the same raw attack but different
 * rarity give different buffs, and past the cap extra raw stat is worth exactly
 * nothing. That's why a flat +20,000 Attack roll and a +2% Attack roll can't be
 * compared by raw magnitude — which is what the optimizer's per-stat inventory
 * scale used to do (see computeStatScale in app.js).
 *
 * The curve, fitted against 40 observed hero readings (published community
 * sheet + hand-collected heroes), is a plain power law up to the cap:
 *
 *     percent = min(cap, A * raw^0.6)
 *
 * The 0.6 exponent is shared by all three stats and all rarities — a free fit
 * over the pooled data lands on 0.593, and locking it to 0.6 costs nothing
 * (0.53% log-RMSE across the 27 usable sub-cap readings, with no systematic
 * sign bias in the residuals). A and the cap are per rarity per stat.
 *
 * Rather than store A directly, each entry records the two numbers that mean
 * something in-game — the cap, and the raw stat that first reaches it — and A
 * is derived from them. That keeps the curve continuous at the cap by
 * construction, and makes "am I done stacking flat Attack?" readable off the
 * table.
 *
 * See TUNING at the bottom for which entries are well-evidenced and which are
 * extrapolations waiting on more readings.
 */

const BREAKPOINT_EXPONENT = 0.6;

/** The three raw hero stats that go through a breakpoint curve, mapped to the
 * STAT_LABELS keys the rest of the app uses for the flat stat and for the
 * percentage stat it converts into. */
const BREAKPOINT_STATS = {
  attack: { kind: "atk", percentKey: "attackPercent" },
  defense: { kind: "def", percentKey: "defensePercent" },
  health: { kind: "hp", percentKey: "healthPercent" },
};

/** rarity -> kind -> {cap, statAtCap}. cap is a fraction (0.28 = +28% troop
 * attack), matching how the app stores every other percentage stat. */
const HERO_BREAKPOINTS = {
  LEGENDARY: {
    atk: { cap: 0.28, statAtCap: 848000 },
    def: { cap: 0.14, statAtCap: 1044000 },
    hp: { cap: 0.28, statAtCap: 3180000 },
  },
  EPIC: {
    atk: { cap: 0.25, statAtCap: 754000 },
    def: { cap: 0.125, statAtCap: 938000 },
    hp: { cap: 0.25, statAtCap: 2548000 },
  },
  RARE: {
    atk: { cap: 0.22, statAtCap: 546000 },
    def: { cap: 0.11, statAtCap: 701000 },
    hp: { cap: 0.22, statAtCap: 2231000 },
  },
  // No readings at all for these two rarities. The caps follow the pattern the
  // observed rarities set (health cap == attack cap, defence cap == half of
  // it, stepping 28/25/22 -> 20/18); statAtCap is then whatever the pooled
  // all-rarity coefficient needs to reach that cap. Estimates, not evidence.
  UNCOMMON: {
    atk: { cap: 0.20, statAtCap: 501000 },
    def: { cap: 0.10, statAtCap: 617000 },
    hp: { cap: 0.20, statAtCap: 1796000 },
  },
  COMMON: {
    atk: { cap: 0.18, statAtCap: 421000 },
    def: { cap: 0.09, statAtCap: 517000 },
    hp: { cap: 0.18, statAtCap: 1507000 },
  },
};

/** Heroes whose rarity we don't know score against this one. EPIC is the
 * best-evidenced curve (all three of its caps are confirmed by real readings)
 * and sits in the middle of the observed range, so guessing it is the least
 * wrong default. */
const DEFAULT_HERO_RARITY = "EPIC";

/** The CSV export has no hero rarity column, but hero_definition_id carries it
 * as a suffix on most heroes ("bloodreaver_epic", "healer_rare"). A few
 * definition ids don't follow the pattern and need naming here — an id that
 * matches neither returns null, and the caller falls back to
 * DEFAULT_HERO_RARITY. */
const HERO_DEFINITION_RARITY = {
  starter_warlord: "COMMON",    // Warlord Marcus
  starter_gatherer: "COMMON",   // Gatherer Elena
  garrison_theron: "UNCOMMON",  // Ironwall Theron
};

function heroRarityFromDefinitionId(definitionId) {
  if (!definitionId) return null;
  if (definitionId in HERO_DEFINITION_RARITY) return HERO_DEFINITION_RARITY[definitionId];
  const suffix = String(definitionId).split("_").pop().toUpperCase();
  return suffix in HERO_BREAKPOINTS ? suffix : null;
}

function breakpointFor(rarity, kind) {
  const table = HERO_BREAKPOINTS[rarity] || HERO_BREAKPOINTS[DEFAULT_HERO_RARITY];
  return table[kind] || null;
}

/** A in `percent = A * raw^0.6`, derived so the curve meets its cap exactly at
 * statAtCap. */
function breakpointCoefficient(bp) {
  return bp.cap / Math.pow(bp.statAtCap, BREAKPOINT_EXPONENT);
}

/** The troop buff (as a fraction) a hero with this much raw stat actually
 * grants. Returns 0 for unknown stat kinds so callers can stay total. */
function heroStatPercent(rarity, kind, rawTotal) {
  const bp = breakpointFor(rarity, kind);
  if (!bp || !(rawTotal > 0)) return 0;
  if (rawTotal >= bp.statAtCap) return bp.cap;
  return breakpointCoefficient(bp) * Math.pow(rawTotal, BREAKPOINT_EXPONENT);
}

/** The raw stat that first reaches the cap — past this, more of that flat stat
 * is worth literally nothing to this hero. */
function heroStatCapPoint(rarity, kind) {
  const bp = breakpointFor(rarity, kind);
  return bp ? bp.statAtCap : Infinity;
}

/** What adding `delta` raw stat on top of `baseTotal` is really worth, in
 * buff percentage. This is the honest answer — it accounts for the curve
 * flattening across the range AND for running into the cap partway — and it's
 * what item comparison should use whenever the hero's current total is known.
 * A negative delta (taking gear off) correctly returns a negative number. */
function heroStatPercentGain(rarity, kind, baseTotal, delta) {
  if (!delta) return 0;
  const from = Math.max(0, baseTotal || 0);
  const to = Math.max(0, from + delta);
  return heroStatPercent(rarity, kind, to) - heroStatPercent(rarity, kind, from);
}

/** Buff percentage per single point of raw stat at a given total — the slope
 * of the curve, d(percent)/d(raw). Zero at or past the cap.
 *
 * This is the linearisation the optimizer's scoring uses: scoring ranks one
 * item at a time with no knowledge of what else ends up equipped, so it can't
 * use the exact stepped gain above without the answer depending on the order
 * items happen to be scored in. Over the few-tens-of-thousands of raw stat a
 * single item swing represents, against a hero sitting in the hundreds of
 * thousands, the slope is near enough constant that the two agree closely —
 * and unlike the old inventory-max scale, this one is in real buff units. */
function heroStatMarginalPerPoint(rarity, kind, rawTotal) {
  const bp = breakpointFor(rarity, kind);
  if (!bp) return 0;
  const total = Math.max(0, rawTotal || 0);
  if (total >= bp.statAtCap) return 0;
  // The slope goes to infinity at raw = 0, which would make the first point of
  // a stat infinitely valuable on a bare hero. Clamp the evaluation point to a
  // small fraction of the cap so a hero with no recorded total still scores
  // sanely instead of blowing up.
  const floor = bp.statAtCap * 0.01;
  const at = Math.max(total, floor);
  return breakpointCoefficient(bp) * BREAKPOINT_EXPONENT
    * Math.pow(at, BREAKPOINT_EXPONENT - 1);
}

/**
 * HERO LEVEL SCALING — a hero's gearless stats at any level, and how the
 * account's multipliers turn those into the number the game shows.
 *
 * The whole stat pipeline, confirmed against the in-game stat page (which
 * helpfully prints "BASE x, EQUIP y" under each stat) and against the export:
 *
 *     hero_stats = (rawBase + rawGear x EQUIPMENT_STAT_MULTIPLIER)
 *                  x HERO_STAT_RESEARCH[stat]
 *
 * Three separate things, and the app has to keep them apart:
 *
 *   rawBase   the hero's own stat at their level — what the stat page calls
 *             BASE, and what HERO_BASE_STATS stores. Grows with level.
 *   rawGear   the summed resolved_stats of equipped items, exactly as the
 *             export gives them. Unmultiplied.
 *   the two multipliers, both account-wide, neither of them per-hero.
 *
 * Levelling itself is plain linear:
 *
 *     rawBase(level) = base + perLevel * (level - 1)
 *
 * Attack, Defence and Health all grow at almost exactly 1/7 of base per level
 * (14.2857%), and that holds across every hero and rarity measured so far —
 * see HERO_STAT_GROWTH_RATE. Specialty does not: its growth rate is authored
 * per hero (0.8%, 1.0%, 1.3% and 2.0% of base per level in the four rows
 * below), so specialty only reaches ~1.4-2x base at level 50 while the combat
 * stats reach 8x. Specialty also takes nothing from gear — equipping a piece
 * moved all three combat stats and left specialtyValue untouched.
 *
 * The ~0.05% scatter around 1/7 means the game stores base and perLevel as two
 * separately authored numbers rather than deriving one from the other, so
 * don't try to recover base as `perLevel * 7` — it's off by tens of points.
 */

/** Attack/Defence/Health gained per level, as a fraction of the level-1 base.
 * At the level cap of 50 this makes a hero's combat stats exactly 8x base
 * (1 + 49/7). Only accurate to about ±0.05% on any individual row — it's for
 * estimating unmeasured heroes, not for replacing a fitted HERO_BASE_STATS
 * entry. */
const HERO_STAT_GROWTH_RATE = 1 / 7;

/** The hero level cap, i.e. the largest level HERO_BASE_STATS is meant to be
 * projected to. */
const HERO_MAX_LEVEL = 50;

/** Account-wide Hero Research, as a multiplier per stat — Combat Training
 * (Hero Attack), Resilience (Hero Defence) and Vitality (Hero HP) on the hero's
 * Research panel. It multiplies the hero's own base AND their gear, and it's
 * the reason Health behaves differently from Attack and Defence. Bump these
 * when the research levels up. */
const HERO_STAT_RESEARCH = {
  attack: 1.06,   // Combat Training, Hero Attack +6%
  defense: 1.06,  // Resilience, Hero Defence +6%
  health: 1.04,   // Vitality, Hero HP +4%
};

/** Account-wide Equipment Stat Bonus, applied to gear only, before the
 * research multiplier. */
const EQUIPMENT_STAT_MULTIPLIER = 1.15;

/** The research multipliers that were in effect when HERO_BASE_STATS was
 * fitted. Kept separate from HERO_STAT_RESEARCH on purpose: the rows below are
 * recorded in export units (research already baked in, because that's all an
 * export can show), so recovering a research-free base means dividing by the
 * values from FIT TIME, not by whatever the research happens to be today. Once
 * the research levels up, HERO_STAT_RESEARCH moves and this doesn't, and the
 * rows stay correct. */
const HERO_STAT_RESEARCH_AT_FIT = { attack: 1.06, defense: 1.06, health: 1.04 };

/** What one raw point of gear is actually worth on a hero's sheet, per stat:
 * the Equipment Stat Bonus and the research multiplier compounded. Measured at
 * 1.2190 / 1.2190 / 1.1960 across nine independent readings (three heroes x
 * three stats, each agreeing to five significant figures), which is exactly
 * 1.15 x 1.06 and 1.15 x 1.04. */
function heroGearMultiplier(stat) {
  const key = HERO_STAT_KIND_TO_NAME[stat] || stat;
  const research = HERO_STAT_RESEARCH[key];
  return research ? EQUIPMENT_STAT_MULTIPLIER * research : 1;
}

/** hero_definition_id -> stat -> {base, perLevel}, keyed by the stat names the
 * CSV export's hero_stats blob uses.
 *
 * UNITS: these are in EXPORT units — research already baked in, gear excluded.
 * A row projects the hero_stats an unequipped hero would export, which is what
 * makes it directly comparable to a reading. Divide by
 * HERO_STAT_RESEARCH_AT_FIT for the research-free base the stat page shows, or
 * use heroRawBaseStatAtLevel.
 *
 * Fitted from two exports taken either side of a level-up, with the hero fully
 * unequipped both times — that's the only way to see the gearless curve, since
 * the export gives totals, not bases. */
const HERO_BASE_STATS = {
  // Moonveil Seraphina, fitted across levels 44 -> 45.
  healer_rare: {
    attack: { base: 22552, perLevel: 3226 },
    defense: { base: 43958, perLevel: 6285 },
    health: { base: 161616, perLevel: 23088 },
    specialtyValue: { base: 0.115, perLevel: 0.001495 },
  },
  // Stonewall Borin, fitted across levels 7 -> 9. The only two-level reading,
  // and the one that proves perLevel is a constant: his deltas came out at
  // exactly 2x the single-level ones, which rules out a compounding curve or
  // per-level rounding.
  guardian_common: {
    attack: { base: 5300, perLevel: 757 },
    defense: { base: 27667, perLevel: 3952 },
    health: { base: 52312, perLevel: 7473 },
    specialtyValue: { base: 0.05, perLevel: 0.0004 },
  },
  // Dawnbringer Valeria, fitted across levels 30 -> 31.
  champion_legendary: {
    attack: { base: 100470, perLevel: 14356 },
    defense: { base: 9204, perLevel: 1318 },
    health: { base: 276539, perLevel: 39505 },
    specialtyValue: { base: 0.025, perLevel: 0.0005 },
  },
  // Ironwall Theron, fitted across levels 47 -> 48. The only UNCOMMON row, and
  // the only one fitted at the top of the level range — the other three sit at
  // 45, 31 and 9, so this is what says the curve is still linear up near the
  // cap.
  garrison_theron: {
    attack: { base: 12838, perLevel: 1832 },
    defense: { base: 61678, perLevel: 8796 },
    health: { base: 110748, perLevel: 15806 },
    specialtyValue: { base: 0.092, perLevel: 0.00092 },
  },
};

/** Maps a BREAKPOINT_STATS kind ("atk") back to the stat name HERO_BASE_STATS
 * and the CSV export use ("attack"), so callers holding either vocabulary can
 * reach this table. */
const HERO_STAT_KIND_TO_NAME = { atk: "attack", def: "defense", hp: "health" };

/** The fitted growth row for one stat, or null if this hero has never been
 * measured. `stat` accepts either vocabulary — "attack" or "atk". */
function heroStatGrowth(definitionId, stat) {
  const row = HERO_BASE_STATS[definitionId];
  if (!row) return null;
  return row[HERO_STAT_KIND_TO_NAME[stat] || stat] || null;
}

/** A hero's gearless value for one stat at `level`, or null if unmeasured.
 * Exact for attack/defence/health; specialty carries the usual float error, so
 * round before displaying it. */
function heroStatAtLevel(definitionId, stat, level) {
  const growth = heroStatGrowth(definitionId, stat);
  if (!growth || !(level >= 1)) return null;
  return growth.base + growth.perLevel * (level - 1);
}

/** All of a hero's gearless stats at `level`, shaped like the export's
 * hero_stats blob so it can be diffed against a real reading directly. Returns
 * null for an unmeasured hero rather than a partial object. */
function heroStatsAtLevel(definitionId, level) {
  const row = HERO_BASE_STATS[definitionId];
  if (!row || !(level >= 1)) return null;
  const out = {};
  for (const stat of Object.keys(row)) {
    out[stat] = heroStatAtLevel(definitionId, stat, level);
  }
  return out;
}

/** A hero's base for one stat at `level` — the number the game's own stat page
 * prints as "BASE", with the gear and the research taken back out.
 *
 * "Base" means what the game means by it, which is not necessarily the hero's
 * unbuffed value: any other account-wide bonus that lands on a hero's own stats
 * is inside this figure, because it's inside the reading it came from. The
 * account this was fitted on carries a 23% Hero Stat Bonus that appears nowhere
 * between the stat page's BASE and its displayed total, so if that bonus
 * touches hero stats at all it is already in here. See TUNING.
 *
 * Comes out fractional, because the fitted rows are export integers being
 * divided by the fit-time research. That's honest: the export can't show more
 * precision than it has, and the fraction is under a unit of noise either way.
 * Returns null for an unmeasured hero, or for specialty, which has no research
 * multiplier to remove. */
function heroRawBaseStatAtLevel(definitionId, stat, level) {
  const key = HERO_STAT_KIND_TO_NAME[stat] || stat;
  const research = HERO_STAT_RESEARCH_AT_FIT[key];
  if (!research) return null;
  const exported = heroStatAtLevel(definitionId, key, level);
  return exported === null ? null : exported / research;
}

/** Estimated level-1 base for a hero with no HERO_BASE_STATS row, backed out
 * of a single gearless reading by assuming the shared 1/7 growth rate:
 *
 *     base = stat * 7 / (level + 6)
 *
 * Good to roughly ±0.25%, because the true per-hero rate wobbles around 1/7.
 * Comes back in whatever units went in — feed it a gearless export reading and
 * the answer carries research the same way HERO_BASE_STATS does. Only
 * meaningful if the hero really had nothing equipped when read, since the
 * export reports totals and gear silently inflates the answer. Specialty is
 * deliberately not estimated: its rate is per hero, so there's nothing to
 * assume. */
function estimateHeroBaseStat(rawTotal, level) {
  if (!(rawTotal > 0) || !(level >= 1)) return null;
  return rawTotal / (1 + HERO_STAT_GROWTH_RATE * (level - 1));
}

/**
 * TUNING — how much to trust each row.
 *
 * Well evidenced (multiple sub-cap readings agreeing to under 1%):
 *   LEGENDARY def (6 readings), LEGENDARY hp (5), EPIC def (5), EPIC hp (5),
 *   EPIC atk (3). EPIC's caps are the only ones confirmed outright by readings
 *   that actually sit on them — 25% atk, 12.5% def (Hadrian at 1M defence),
 *   25% hp. LEGENDARY's 28% atk and 28% hp caps are confirmed the same way.
 *
 * Thin:
 *   LEGENDARY atk rests on a single sub-cap reading (833k -> 27.70%); every
 *   other legendary attack reading is already pinned at the 28% cap.
 *   All three RARE curves rest on one reading each, so they fit perfectly by
 *   construction and are entirely unvalidated.
 *   LEGENDARY and RARE defence caps are inferred from the "defence cap is half
 *   the attack cap" pattern, not observed — no reading gets near them.
 *
 * Guessed outright:
 *   UNCOMMON and COMMON, both rows. No data.
 *
 * Known anomaly:
 *   Durgan (Epic) reads 250k defence -> 7.0%, where the curve says 5.8%. That's
 *   24% hot, far outside the sub-1% scatter every other reading shows, and his
 *   attack reading (510k -> 19.8%) sits dead on the Epic attack curve. So it
 *   isn't his rarity being mislabelled — something is adding defence percentage
 *   outside the curve, or the reading is off. Excluded from the fit.
 *
 * Most useful readings to collect next, in order: sub-cap RARE readings of any
 * stat; any UNCOMMON or COMMON hero at all; a LEGENDARY hero under ~840k attack;
 * and a high-defence LEGENDARY (over ~600k) to test the 14% cap.
 *
 * HERO_BASE_STATS is on a separate footing. Each row is fitted from two exact
 * readings, so it reproduces them exactly by construction — the open question
 * isn't precision, it's whether growth stays linear outside the levels
 * measured. Borin's row spans two levels and came out perfectly linear, which
 * is the only direct evidence; the other three span a single level each and
 * lean on that plus the shared 1/7 rate. The four rows sit at levels 9, 31, 45
 * and 48, so the middle of the range is well covered and level 1 is still an
 * extrapolation.
 *
 * Adding a hero needs two exports of them fully unequipped, at least one level
 * apart. A hero levelled two or more steps is worth more than two heroes
 * levelled one, since only a multi-level span re-tests linearity — and a low
 * level is worth more than another mid-range one, since nothing yet pins the
 * bottom of the curve.
 *
 * EQUIPMENT_STAT_MULTIPLIER and HERO_STAT_RESEARCH are the best-evidenced
 * numbers in this file. Their product was measured nine independent ways —
 * three geared heroes x three stats — landing in 1.21899-1.21911 against a
 * predicted 1.2190, and 1.19599-1.19601 against 1.1960. The residual scatter
 * is the size of a half-unit rounding on hero_stats, so there is nothing left
 * to explain. What's NOT pinned is the split between the two: only the product
 * is observable here, and 1.15 x 1.06 was taken from the game's own research
 * and equipment screens rather than fitted. Any other pair with the same
 * product would fit this data identically.
 *
 * The account's 23% Hero Stat Bonus is deliberately absent from all of this,
 * because it cannot be found. Applied on top of gear it would make the gear
 * multiplier 1.4994 where nine readings say 1.2190; applied between the stat
 * page's BASE and its displayed total it would make Seraphina read 202K
 * gearless where she reads 164K. Both are ruled out by margins hundreds of
 * times the measurement noise. That leaves two possibilities the data can't
 * separate: it is already inside the BASE figure, and therefore inside
 * HERO_BASE_STATS, or it applies to troops rather than to the hero's own
 * Attack/Defence/Health. Nothing here depends on which — every calculation is
 * anchored to exported totals and gear differences, never to an unbuffed base.
 *
 * What it WOULD change is staleness. If that bonus is inside the rows and can
 * move, the rows go stale when it moves, exactly as they would if research
 * levelled. adoptMeasuredGearMultipliers is the tripwire either way: a base
 * that has shifted under a fixed row lands in the measured gear multiplier and
 * shows up as drift. To settle it outright, change the bonus and re-export —
 * if a gearless hero's numbers move, it lives in the base.
 *
 * Two loose ends on specialtyValue. It takes nothing from gear (equipping a
 * piece left it unchanged on all three heroes), so no gear multiplier applies.
 * And whether the account's +15% Specialty Bonus is baked into the export is
 * genuinely unresolved: Seraphina's 0.115 and Theron's 0.092 divide by 1.15 to
 * a clean 0.1 and 0.08, but Borin's 0.05 and Valeria's 0.025 are already clean
 * and divide to nothing recognisable. Two clean out of four is what chance
 * looks like, so nothing here assumes it either way.
 */
