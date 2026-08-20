(() => {
  "use strict";

  const NO_HERO_OWNER = "";
  const LOADOUTS_STORAGE_KEY = "tyrant-equipment-loadouts-v1";
  /** Bumped to v2 when heroes gained statTotals/rarity/level for the breakpoint
   * curves (hero-breakpoints.js). A v1 payload has heroes without those fields,
   * and nothing re-derives them on load — the CSV isn't re-parsed — so it would
   * load into an app that then silently hides Army command and scores flat
   * stats off the old inventory-max scale. The version is part of the key so
   * stale shapes are never read at all; isUsableEquipmentData below is the
   * backstop for anything that slips through under the current key. */
  const EQUIPMENT_STORAGE_KEY = "tyrant-equipment-data-v2";
  const LOCKED_SLOTS_STORAGE_KEY = "tyrant-equipment-locked-slots-v1";
  const TROOP_PRESETS_STORAGE_KEY = "tyrant-troop-priority-presets-v1";
  const GEAR_MULTIPLIER_STORAGE_KEY = "tyrant-gear-multipliers-v1";
  const SHOW_UPGRADE_PLAN_STORAGE_KEY = "tyrant-show-upgrade-plan-v1";
  const SHOW_PVP_PLAN_STORAGE_KEY = "tyrant-show-pvp-plan-v1";
  /** Key kept from when this number was a per-piece look-ahead window rather
   * than a pot to split: it holds the same figure the user typed either way,
   * and a rename would silently reset it back to the default for everyone. */
  const UPGRADE_BUDGET_STORAGE_KEY = "tyrant-upgrade-xp-horizon-v1";
  const ACTIVE_OWNER_STORAGE_KEY = "tyrant-active-owner-v1";
  const OPTIMIZE_SETUP_STORAGE_KEY = "tyrant-optimize-setup-v1";
  /** How much XP the upgrade plan splits by default. Roughly the point where
   * an under-levelled piece and a near-capped one separate clearly. */
  const DEFAULT_UPGRADE_XP_BUDGET = 50000;

  /** Built-in presets for the optimize weights. Picking one fills the weight
   * inputs with a full stat weighting tuned for a way of playing — four troop
   * types and Gathering; "custom" leaves whatever the user has typed alone.
   * The "troop" in the identifiers around this is historical: presets began as
   * troop types only, and the storage key and backup field still say so, so
   * renaming them would orphan every saved default.
   *
   * Keys are STAT_LABELS keys; only weights for stats actually present in the
   * inventory end up applied (see applyTroopPreset). A player can override any
   * of these with their own default via state.customTroopPresets.
   *
   * These are BASE weights: what each stat is worth to this preset before any
   * account bonus. scenarioWeights() scales them on the way out, so the
   * numbers here stay hand-readable and the bonuses stay in one place.
   *
   * attack/defense/health deliberately carry the SAME base weight as their
   * percentage twin. Both buy the same thing — a troop buff — and since
   * computeBreakpointScale() scores the flat stat in units of that buff, equal
   * base weights correctly say "a point of buff is a point of buff, however I
   * bought it". They used to sit at weight 1 as a crude way of keeping flat
   * stats from swamping the score on raw magnitude alone; that hack is what
   * the breakpoint scale replaces. The applied weights then diverge, because
   * the gear multiplier lifts the flat stat and not its percentage twin. */
  const TROOP_PRIORITY_PRESETS = {
    archer: {
      label: "Archer",
      weights: {
        attack: 5000,
        defense: 500,
        health: 1000,
        marchSpeed: 1000,
        pvpAttack: 5001,
        attackPercent: 5000,
        pvpDefense: 1001,
        defensePercent: 500,
        healthPercent: 1000,
        archerAttack: 4999,
        archerDefense: 499,
        archerHealth: 999,
        firstRoundDamage: 2500,
        marchCapacity: 1500,
      },
    },
    /** The tankless two-troop march: cavalry charging in, archers shooting
     * over them. Unlike the infantry pairings there's no wall here — both
     * halves are damage troops — so this follows the Cavalry preset's spine
     * (Attack on top, Health at a fifth of it, Defence at a tenth) rather than
     * Infantry's, and both troops' own Attack sits with generic Attack.
     *
     * The two Attacks sit a point apart in Mixed's order, archer then cavalry,
     * purely so a piece that only differs in which of the two it favours still
     * sorts. Nothing about the composition says either half kills more.
     *
     * No troop-affinity multiplier, same as the other hybrids: it attaches to
     * exactly one troop type and nothing in the export says which.
     *
     * First Round Damage keeps the full Archer/Cavalry value rather than the
     * infantry pairings' half. There it pays on the damage half of the march
     * only; here the whole march is the damage half. */
    archerCavalry: {
      label: "Archer / Cavalry",
      weights: {
        attack: 5000,
        defense: 500,
        health: 1000,
        marchSpeed: 1000,
        pvpAttack: 5001,
        attackPercent: 5000,
        pvpDefense: 1001,
        defensePercent: 500,
        healthPercent: 1000,
        archerAttack: 4999,
        // Attack only, as in Infantry / Archer: archers shoot from behind the
        // charge, so a piece buying their Defence or Health is buying nothing
        // this composition ever uses.
        cavalryAttack: 4998,
        // The cavalry are what the enemy actually hits, with no infantry in
        // front of them, so their bulk keeps the full Cavalry-preset weight
        // instead of the reduced one the Infantry / Cavalry pairing gives it.
        cavalryDefense: 499,
        cavalryHealth: 999,
        firstRoundDamage: 2500,
        marchCapacity: 1500,
      },
    },
    cavalry: {
      label: "Cavalry",
      weights: {
        attack: 5000,
        defense: 500,
        health: 1000,
        marchSpeed: 1000,
        pvpAttack: 5001,
        attackPercent: 5000,
        pvpDefense: 1001,
        defensePercent: 500,
        healthPercent: 1000,
        cavalryAttack: 4999,
        cavalryDefense: 499,
        cavalryHealth: 999,
        firstRoundDamage: 2500,
        marchCapacity: 1500,
      },
    },
    /** Not a troop type — a job. Nothing here goes near combat: the gathering
     * stats are all percentages with no breakpoint curve and no troop affinity
     * behind them, so these weights reach scoring exactly as written.
     *
     * The ordering is the whole preset. Gather Speed applies to every node you
     * ever sit on, so it leads; Node Yield is next because it pays on every
     * gather too, but only on what the node holds. The per-resource speeds are
     * a quarter of the general one — each covers a single resource, so a piece
     * carrying one is worth roughly a quarter as often. March Speed sits below
     * them all: it shortens the trip, not the gather, and the trip is the small
     * half of a run. */
    gathering: {
      label: "Gathering",
      weights: {
        gatherSpeed: 5000,
        nodeYield: 2500,
        gatherSpeedFood: 1250,
        gatherSpeedWood: 1250,
        gatherSpeedStone: 1250,
        gatherSpeedGold: 1250,
        marchSpeed: 600,
      },
    },
    /** Damage-first, in three clear tiers: generic Attack on top, Infantry
     * Attack at half of it, Defence and Health at a fifth.
     *
     * Infantry Attack sits a tier below generic Attack rather than alongside
     * it (the Archer/Cavalry pattern) because generic Attack is the line every
     * attack-scaling piece can be compared on, and because Infantry Attack
     * additionally collects the 20% troop affinity this preset applies — half
     * the base weight still leaves it clearly ahead of the bulk stats once
     * both are scaled by scenarioWeights().
     *
     * Defence and Health keep a fifth of the top weight rather than dropping
     * out: enough to separate two pieces that offer the same damage, not
     * enough to buy a bulk piece over a damage one. */
    infantry: {
      label: "Infantry",
      weights: {
        attack: 5000,
        defense: 1000,
        health: 1000,
        marchSpeed: 1000,
        pvpAttack: 5001,
        attackPercent: 5000,
        pvpDefense: 1001,
        defensePercent: 1000,
        healthPercent: 1000,
        infantryAttack: 2500,
        infantryDefense: 999,
        infantryHealth: 999,
        firstRoundDamage: 1,
        marchCapacity: 1500,
      },
    },
    /** The two-troop marches: infantry up front soaking the hits, a second
     * type behind them doing the damage. Both share the Infantry preset's
     * spine — generic Attack on top, Infantry Attack at half of it, Defence
     * and Health at a fifth — and differ only in which second troop's stats
     * they buy. The second troop's own Attack sits with generic Attack rather
     * than below it: that half of the march is there to kill things.
     *
     * Neither gets a troop-affinity multiplier (they're absent from
     * PRESET_TROOP_STAT_PREFIX, like Mixed). Affinity attaches to exactly one
     * troop type, and nothing in the export says which, so a hybrid can't
     * claim it for both halves without inventing the answer.
     *
     * First Round Damage sits at half the Archer/Cavalry value: it pays on the
     * damage half of the march only. */
    infantryArcher: {
      label: "Infantry / Archer",
      weights: {
        attack: 5000,
        defense: 1000,
        health: 1000,
        marchSpeed: 1000,
        pvpAttack: 5001,
        attackPercent: 5000,
        pvpDefense: 1001,
        defensePercent: 1000,
        healthPercent: 1000,
        infantryAttack: 2500,
        infantryDefense: 999,
        infantryHealth: 999,
        // Attack only. Archers stand behind the wall, so their own Defence and
        // Health never get tested — a piece carrying them is carrying dead
        // weight for this composition, and is left unscored rather than
        // scored low.
        archerAttack: 4999,
        firstRoundDamage: 1250,
        marchCapacity: 1500,
      },
    },
    infantryCavalry: {
      label: "Infantry / Cavalry",
      weights: {
        attack: 5000,
        defense: 1000,
        health: 1000,
        marchSpeed: 1000,
        pvpAttack: 5001,
        attackPercent: 5000,
        pvpDefense: 1001,
        defensePercent: 1000,
        healthPercent: 1000,
        infantryAttack: 2500,
        infantryDefense: 999,
        infantryHealth: 999,
        // All three, unlike the archer pairing: cavalry charge into the same
        // fight the infantry are holding, so their bulk earns its keep. Attack
        // still leads — they're the half that's there to kill things.
        cavalryAttack: 4999,
        cavalryDefense: 400,
        cavalryHealth: 400,
        firstRoundDamage: 1250,
        marchCapacity: 1500,
      },
    },
    /** Everything in one march, so the generic stats carry the weight and the
     * troop-type ones only break ties between otherwise equal pieces.
     *
     * The three Attacks sit a step apart rather than level — archer, then
     * cavalry, then infantry — so a piece that only differs in which troop it
     * favours still sorts, without the gap being wide enough to outrank a
     * piece carrying more of anything else.
     *
     * Infantry follows the Infantry preset's spine: Attack on top, Defence and
     * Health at the same 2.5:1 behind it. Infantry are the front line here, but
     * a piece that only adds to their bulk still buys less than one that adds
     * damage — the same call the Infantry preset makes. */
    mixed: {
      label: "Mixed",
      weights: {
        attack: 5000,
        defense: 4000,
        health: 4000,
        marchSpeed: 1000,
        pvpAttack: 5001,
        attackPercent: 5000,
        pvpDefense: 4001,
        defensePercent: 4000,
        healthPercent: 4000,
        archerAttack: 1000,
        cavalryAttack: 950,
        infantryAttack: 900,
        archerDefense: 100,
        cavalryDefense: 750,
        infantryDefense: 360,
        archerHealth: 100,
        cavalryHealth: 750,
        infantryHealth: 360,
        firstRoundDamage: 2500,
        marchCapacity: 1500,
      },
    },
  };

  const state = {
    slotOrder: SLOT_ORDER,
    itemsBySlot: {},
    /** statKey -> largest absolute value that stat reaches anywhere in the
     * current inventory. weightedScore divides each raw stat by this so a
     * weight means the same thing across wildly different stat scales — see
     * computeStatScale(). Recomputed whenever inventory changes. */
    statScale: {},
    /** statKey -> divisor for the three flat stats that run through a hero
     * breakpoint curve (attack/defense/health), computed for whichever hero is
     * active. Overrides statScale for those keys in weightedScore — see
     * computeBreakpointScale(). Empty when the active hero's rarity and stat
     * totals aren't known, which falls scoring back to the inventory scale. */
    breakpointScale: {},
    /** Whether the Upgrade plan panel is expanded. Display only: it changes
     * nothing about how gear is scored or which items auto-optimize picks.
     * Persisted, so the panel is how you left it on the next visit. Starts
     * closed — the plan only means something once weights are set. */
    showUpgradePlan: false,
    /** Whether the PvP shop panel is expanded. Same deal, but open by default:
     * it answers "what do I spend Valor on", which needs no setup beyond the
     * weights the panel above it already asks for. */
    showPvpPlan: true,
    /** The pot of XP the upgrade plan splits across the equipped pieces. A
     * real budget: the rows carve this up between them rather than each costing
     * it separately, so the plan answers "I have this much XP, where does it
     * go" rather than "which piece would like it most".
     * Only the plan reads it; it never changes which items the optimizer picks. */
    upgradeXpBudget: DEFAULT_UPGRADE_XP_BUDGET,
    heroes: SAMPLE_HEROES,
    availableStats: [],
    knownSetSizes: SAMPLE_KNOWN_SET_SIZES,
    isSampleData: true,
    isLive: false,
    /** ownerKey (hero id, or "" for the no-hero scratch space) -> {slot: itemId|null} */
    loadoutsByOwner: {},
    /** ownerKey -> Set<slot>. Locked slots are left untouched by
     * auto-optimize and can't be changed by it, but can still be edited
     * by hand via the picker. */
    lockedSlotsByOwner: {},
    /** which owner's loadout is currently shown */
    activeOwner: NO_HERO_OWNER,
    /** cached previous nonzero-stat text, keyed by stat key, for flash-on-change */
    lastTotalsByKey: {},
    /** Set of stat keys currently checked in the Filter menu. An item
     * matches if it has ANY of these stats (OR, not AND). Empty = no filter. */
    activeStatFilters: new Set(),
    /** Set of rarity strings currently checked. ANY-match, same as stats.
     * Combined with the stat filter via AND: an item must match the rarity
     * filter AND the stat filter (each individually empty = unrestricted). */
    activeRarityFilters: new Set(),
    /** Item ids checked in the currently-open picker's compare checkboxes
     * (max 2 — see handlePickerCompareToggle). Cleared whenever the picker closes. */
    pickerCompareSelection: [],
    /** Global item-name search (topbar), lowercased. Combines with the
     * stat/rarity filters via AND, same as they combine with each other. */
    globalSearchQuery: "",
    /** Search box INSIDE the currently-open picker — narrows just that
     * slot's list further, independent of the global search. Reset when
     * the picker closes. */
    pickerSearchQuery: "",
    /** Stat keys checked in the currently-open picker's OWN stat filter —
     * distinct from the global topbar Filter menu. ANY-match. Reset when
     * the picker closes. */
    pickerStatFilters: new Set(),
    /** statKey -> weight (number, can be 0). Drives auto-optimize's scoring
     * function: an item's score is the weighted sum of its raw stats.
     * A single stat at weight 1 with everything else 0 behaves exactly
     * like the old single-stat optimize. */
    optimizeWeights: {},
    /** troopKey -> {statKey: weight}. A player's own saved defaults for the
     * troop-priority dropdown, overriding the built-in TROOP_PRIORITY_PRESETS
     * for that troop. Persisted to localStorage and included in backup
     * export/import. A troop with no entry here falls back to the built-in. */
    customTroopPresets: {},
    /** Whether every scoring path reads gear at its LEVEL CAP instead of at
     * the level it's actually on. Only attack/defence/health move: those are
     * the three stats a level buys (see LEVEL_SCALED_STAT_KEYS in
     * gear-progression.js), and every percentage affix is a roll fixed by the
     * item's quality when it dropped, so it reads the same at level 1 and at
     * the cap. Answers "which gear wins once I've enhanced everything" rather
     * than "which gear is ahead today", which are different questions whenever
     * an under-levelled legendary is sitting behind a maxed rare.
     *
     * Not optimizer-only: the ledger, the item stat lines and the picker's
     * compare all follow it, or the pick it makes would be unreadable next to
     * numbers taken on a different basis. The Upgrade plan is the one
     * exception — it exists to price the levels this projection assumes you've
     * already bought, so it always reads today's stats (see buildUpgradePlan). */
    maxLevelScoring: false,
    /** Scenario the optimizer scores set bonuses for — see
     * optimizeContextOptions() in set-bonuses.js. "general" (the default)
     * counts only unconditional bonuses, so a Monster-Dens-only set doesn't
     * skew a plain army-attack optimize; pick a specific scenario to
     * deliberately optimize FOR it. Only affects auto-optimize scoring; the
     * ledger still shows every bonus, labeled by where it applies. */
    optimizeContext: "general",
    /** statKey -> what one raw point of gear is worth on this account, as
     * measured off the last import that could measure it. Read through
     * gearMultiplierFor(), which falls back to the constants in
     * hero-breakpoints.js for anything not in here. Empty is a safe default —
     * the constants are themselves measured, and an unmeasured stat scores the
     * same as it did before any import. */
    gearMultipliers: {},
  };

  let pendingLiveEquipPreview = null; // {heroId, loadout} once previewed against the sync server, until confirmed or invalidated

  function activeLoadout() {
    return state.loadoutsByOwner[state.activeOwner];
  }

  function heroName(heroId) {
    const hero = state.heroes.find((h) => h.id === heroId);
    return hero ? hero.name : "another hero";
  }

  /** Meta-line fragment for an item's quality percentage, shown after the
   * level. Empty string when the item has no quality (e.g. sample items or
   * an import whose CSV lacked the quality_percent column). */
  function qualityMetaHtml(it) {
    if (it.quality == null) return "";
    return ` · <span class="quality-pct">${it.quality}% quality</span>`;
  }

  /** The rarity · level · quality line, shared by the slot cards and the picker
   * so the two can't drift.
   *
   * All three sit in ONE span rather than as siblings: both hosts lay their
   * meta line out with flex, which turns every bare text node into a flex item
   * of its own and puts a gap around each " · " — the wrapper keeps the phrase
   * flowing as text and leaves flex to space the dot and the status tags. */
  function itemMetaHtml(it) {
    // While max-level scoring is on the stats below this line are the item's at
    // its cap, so the level has to say so — "Lvl 12" over capped numbers reads
    // as a wildly overstated level-12 piece.
    const levelText = state.maxLevelScoring && it.projectedLevelsToGo
      ? `Lvl ${it.level} → ${it.projectedMaxLevel}`
      : `Lvl ${it.level}`;
    return `<span class="rarity-dot"></span><span class="item-meta-text">${it.rarity} · `
      + `<span class="item-level">${levelText}</span>${qualityMetaHtml(it)}</span>`;
  }

  /** A hero with different march/instanced equip states is split into two
   * owner ids ("<heroId>::march" / "<heroId>::instanced" — see
   * csv-import.js). They're still the same underlying hero, so an item
   * equipped in both isn't really "locked to someone else" — strip the
   * suffix to compare the real hero identity, not the pseudo-owner id. */
  function heroGroupKey(ownerId) {
    return ownerId.replace(/::(march|instanced)$/, "");
  }

  /** itemId -> ownerKey, aggregated across every NAMED hero's loadout.
   * The no-hero scratch space never contributes locks and is never locked
   * against — it's a sandbox for checking hypothetical totals. */
  function computeLockedMap() {
    const locked = new Map();
    for (const [owner, loadout] of Object.entries(state.loadoutsByOwner)) {
      if (owner === NO_HERO_OWNER) continue;
      for (const itemId of Object.values(loadout)) {
        if (itemId) locked.set(itemId, owner);
      }
    }
    return locked;
  }

  function saveLoadouts() {
    try {
      localStorage.setItem(LOADOUTS_STORAGE_KEY, JSON.stringify(state.loadoutsByOwner));
    } catch (err) {
      console.warn("Couldn't save loadouts to localStorage:", err);
    }
  }

  function lockedSlotsForOwner(owner) {
    if (!state.lockedSlotsByOwner[owner]) state.lockedSlotsByOwner[owner] = new Set();
    return state.lockedSlotsByOwner[owner];
  }

  function saveLockedSlots() {
    try {
      const plain = {};
      for (const [owner, slots] of Object.entries(state.lockedSlotsByOwner)) {
        plain[owner] = [...slots];
      }
      localStorage.setItem(LOCKED_SLOTS_STORAGE_KEY, JSON.stringify(plain));
    } catch (err) {
      console.warn("Couldn't save locked slots to localStorage:", err);
    }
  }

  function loadSavedLockedSlots() {
    try {
      const raw = JSON.parse(localStorage.getItem(LOCKED_SLOTS_STORAGE_KEY) || "{}");
      const parsed = {};
      for (const [owner, slots] of Object.entries(raw || {})) {
        if (Array.isArray(slots)) parsed[owner] = new Set(slots.filter((s) => state.slotOrder.includes(s)));
      }
      return parsed;
    } catch (err) {
      console.warn("Couldn't parse saved locked slots:", err);
      return {};
    }
  }

  /** The weights the troop dropdown fills in for a troop type: the player's
   * own saved default if they have one, otherwise the built-in preset. Returns
   * a fresh object (never a shared reference) or null for unknown/"custom". */
  function troopPresetWeights(troopKey) {
    if (state.customTroopPresets[troopKey]) {
      // Taken literally. A saved default is the weights the player actually
      // wants, already carrying whatever scaling was applied when they saved
      // it — scaling again here would compound every time they re-picked it.
      return { ...state.customTroopPresets[troopKey] };
    }
    const preset = TROOP_PRIORITY_PRESETS[troopKey];
    return preset ? scenarioWeights(preset.weights, troopKey) : null;
  }

  /** Account-wide Troop Affinity bonus, as a multiplier. It attaches to one
   * troop type rather than to the account as a whole, so it lands on the
   * troop-type stats of whichever troop a preset is FOR — archerAttack and
   * friends in the Archer preset. Mixed gets none: no single type to attach to.
   *
   * Modelled as a weight rather than measured, unlike the gear multipliers.
   * Nothing in the export distinguishes a troop-type stat that is being
   * boosted from one that isn't, so this is the player's stated 20% taken at
   * face value. */
  const TROOP_AFFINITY_MULTIPLIER = 1.2;

  /** Preset key -> the prefix its troop-type stat keys share. */
  const PRESET_TROOP_STAT_PREFIX = {
    archer: "archer",
    cavalry: "cavalry",
    infantry: "infantry",
  };

  /** Turn a preset's authored base weights into the weights actually applied,
   * by folding in the account bonuses that behave like weights.
   *
   * Two of them, and they're different in kind. The gear multiplier is a
   * measured fact (heroGearMultiplier, 1.2190/1.2190/1.1960) and lands only on
   * the flat Attack/Defence/Health that gear physically multiplies — never on
   * their percentage twins, which the research doesn't touch. Troop affinity is
   * the player's stated 20% and lands only on the preset's own troop-type
   * stats.
   *
   * Both are pure scale factors on a stat's score contribution, which is what
   * makes a weight the honest place for them: weights are relative, so a reader
   * can see the whole ranking in one table instead of half of it hiding in a
   * divisor. What can NOT move here is where a hero stands on their breakpoint
   * curve — see heroStatTotalsFor. */
  function scenarioWeights(baseWeights, troopKey) {
    const affinityPrefix = PRESET_TROOP_STAT_PREFIX[troopKey];
    const weights = {};
    for (const [key, base] of Object.entries(baseWeights)) {
      let weight = base;
      if (key in BREAKPOINT_STATS) weight *= gearMultiplierFor(key);
      if (affinityPrefix && key.startsWith(affinityPrefix)) weight *= TROOP_AFFINITY_MULTIPLIER;
      weights[key] = Math.round(weight);
    }
    return weights;
  }

  function saveTroopPresets() {
    try {
      localStorage.setItem(TROOP_PRESETS_STORAGE_KEY, JSON.stringify(state.customTroopPresets));
    } catch (err) {
      console.warn("Couldn't save troop-priority presets to localStorage:", err);
    }
  }

  /** Parse a raw {statKey:weight} object, keeping known stat keys with a
   * positive numeric weight and dropping everything else. Shared by the troop
   * presets and the saved optimize setup, so a hand-edited or stale entry
   * can't inject junk into either. */
  function sanitizeStatWeights(raw) {
    const clean = {};
    if (!raw || typeof raw !== "object") return clean;
    for (const [statKey, value] of Object.entries(raw)) {
      if (!(statKey in STAT_LABELS)) continue; // drop unknown stat keys from stale/hand-edited files
      const num = Number(value);
      if (Number.isFinite(num) && num > 0) clean[statKey] = num;
    }
    return clean;
  }

  /** Parse a raw troopKey->{statKey:weight} object, keeping only known troop
   * keys and positive numeric weights. Shared by localStorage restore and
   * backup import, so a hand-edited or stale file can't inject junk. */
  function sanitizeTroopPresets(raw) {
    const clean = {};
    if (!raw || typeof raw !== "object") return clean;
    for (const [troopKey, weights] of Object.entries(raw)) {
      if (!(troopKey in TROOP_PRIORITY_PRESETS)) continue;
      const cleanWeights = sanitizeStatWeights(weights);
      if (Object.keys(cleanWeights).length) clean[troopKey] = cleanWeights;
    }
    return clean;
  }

  function loadSavedTroopPresets() {
    try {
      const raw = JSON.parse(localStorage.getItem(TROOP_PRESETS_STORAGE_KEY) || "{}");
      return sanitizeTroopPresets(raw);
    } catch (err) {
      console.warn("Couldn't parse saved troop-priority presets:", err);
      return {};
    }
  }

  /** Smallest equipped gear total worth measuring a gear multiplier from. The
   * estimate divides by the gear total, so the error the game's own rounding
   * leaves in it is about 0.5/gear — 0.025% at this threshold, against a drift
   * tolerance of 0.5%. Deliberately low enough that one item counts: the
   * smallest real reading so far is 6,280 attack on a single piece, and it
   * still lands within 0.01% of the model. */
  const GEAR_MULTIPLIER_MIN_GEAR = 2000;

  /** Measure this account's gear multiplier straight off an import, per stat,
   * using heroes whose gearless curve is already known.
   *
   * With B the projected gearless export value and g the raw gear on the hero,
   * the export reads
   *
   *     hero_stats = B + g x heroGearMultiplier(stat)
   *     => heroGearMultiplier(stat) = (hero_stats - B) / g
   *
   * so the multiplier falls straight out of a single import — no prior
   * snapshot, no user-entered number, and it doesn't care whether the hero
   * levelled. This is what established the 1.2190 / 1.2190 / 1.1960 in
   * hero-breakpoints.js in the first place, so running it again is really a
   * check that the account's Equipment Stat Bonus and Hero Research still match
   * what that file assumes.
   *
   * Kept per stat rather than pooled, because Health genuinely differs from
   * Attack and Defence — Vitality gives +4% where Combat Training and
   * Resilience give +6% — and a median across all three would split the
   * difference and be wrong for every stat.
   *
   * Needs a fitted hero with gear ON them. Returns statKey -> list of
   * estimates, each list possibly empty. */
  function heroGearMultiplierEstimates(heroes) {
    const estimates = {};
    for (const statKey of Object.keys(BREAKPOINT_STATS)) estimates[statKey] = [];
    const seen = new Set();
    for (const hero of heroes) {
      if (!hero.knownBase || !hero.statTotals || !hero.definitionId) continue;
      const key = `${hero.definitionId}@${hero.level}`;
      if (seen.has(key)) continue;
      seen.add(key);
      for (const statKey of Object.keys(BREAKPOINT_STATS)) {
        const gear = (hero.equippedGearTotals && hero.equippedGearTotals[statKey]) || 0;
        if (!(gear > GEAR_MULTIPLIER_MIN_GEAR)) continue;
        const known = hero.knownBase[statKey];
        if (!(known > 0)) continue;
        estimates[statKey].push(((hero.statTotals[statKey] || 0) - known) / gear);
      }
    }
    return estimates;
  }

  /** How far the account's measured gear multipliers drift from what
   * hero-breakpoints.js assumes, as a fraction. Null when nothing could be
   * measured. Anything past a few thousandths means the Equipment Stat Bonus or
   * a Hero Research level has moved and HERO_STAT_RESEARCH /
   * EQUIPMENT_STAT_MULTIPLIER need updating. */
  function heroGearMultiplierDrift(heroes) {
    const estimates = heroGearMultiplierEstimates(heroes);
    const drift = {};
    let measured = 0;
    for (const [statKey, samples] of Object.entries(estimates)) {
      if (!samples.length) continue;
      const sorted = [...samples].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const expected = heroGearMultiplier(statKey);
      if (!expected) continue;
      drift[statKey] = { measured: median, expected, error: median / expected - 1, sampleCount: samples.length };
      measured++;
    }
    return measured ? drift : null;
  }

  /** Largest gap between a measured multiplier and the file's constants worth
   * mentioning. The measurement is good to well under a tenth of a point on
   * real gear totals, so 0.5% is far above the noise and well below one
   * research level, which moves a stat by 1-2%. */
  const GEAR_MULTIPLIER_DRIFT_TOLERANCE = 0.005;

  /** A multiplier has to be at least 1 (gear can't be worth less than its face
   * value) and can't plausibly reach 5. Anything outside that is a corrupt
   * localStorage entry or a measurement taken against the wrong hero, and gets
   * dropped in favour of the constants. */
  function sanitizeGearMultiplier(value) {
    const num = Number(value);
    return Number.isFinite(num) && num >= 1 && num <= 5 ? num : null;
  }

  /** What one raw point of gear is worth on this account, for one stat.
   *
   * Prefers what the last usable import actually measured, and falls back to
   * the constants in hero-breakpoints.js. Measuring beats asking: the export
   * pins it to within 0.01%, whereas the Hero Stat Bonus box this replaced was
   * a single typed number standing in for three real ones and could not be
   * right for Attack, Defence and Health at once — the Equipment Stat Bonus
   * lifts all three equally but Hero Research doesn't (+6/+6/+4). */
  function gearMultiplierFor(statKey) {
    const measured = state.gearMultipliers && state.gearMultipliers[statKey];
    return measured > 0 ? measured : heroGearMultiplier(statKey);
  }

  function saveGearMultipliers() {
    try {
      localStorage.setItem(GEAR_MULTIPLIER_STORAGE_KEY, JSON.stringify(state.gearMultipliers || {}));
    } catch (err) {
      console.warn("Couldn't save the measured gear multipliers to localStorage:", err);
    }
  }

  function loadSavedGearMultipliers() {
    let parsed;
    try {
      parsed = JSON.parse(localStorage.getItem(GEAR_MULTIPLIER_STORAGE_KEY) || "null");
    } catch (err) {
      console.warn("Couldn't parse the saved gear multipliers:", err);
      return {};
    }
    if (!parsed || typeof parsed !== "object") return {};
    const out = {};
    for (const statKey of Object.keys(BREAKPOINT_STATS)) {
      const clean = sanitizeGearMultiplier(parsed[statKey]);
      if (clean !== null) out[statKey] = clean;
    }
    return out;
  }

  /** Take the gear multipliers this import measured and keep them.
   *
   * Only stats the import could actually measure are touched, so a stat with no
   * fitted-and-geared hero this time keeps whatever the last usable import
   * found rather than snapping back to the constants. Silent unless a
   * multiplier has moved materially from what hero-breakpoints.js assumes,
   * which means the account's Equipment Stat Bonus or a Hero Research level has
   * changed — worth saying out loud, since scoring quietly changes with it. */
  function adoptMeasuredGearMultipliers(heroes) {
    const drift = heroGearMultiplierDrift(heroes);
    if (!drift) return;
    const moved = [];
    for (const [statKey, d] of Object.entries(drift)) {
      const clean = sanitizeGearMultiplier(d.measured);
      if (clean === null) continue;
      state.gearMultipliers[statKey] = clean;
      if (Math.abs(d.error) > GEAR_MULTIPLIER_DRIFT_TOLERANCE) {
        moved.push(`${statKey} ${clean.toFixed(4)}x (file says ${d.expected.toFixed(4)}x)`);
      }
    }
    saveGearMultipliers();
    refreshBreakpointScale();
    if (moved.length) {
      showToast(`Gear multipliers measured off this import: ${moved.join(", ")}. Scoring now uses `
        + `the measured values — your Equipment Stat Bonus or Hero Research has changed.`);
    }
  }

  /** Sanitize a raw ownerKey->{slot:itemId} object against the CURRENT
   * inventory: drop any item id that no longer exists (consumed/changed
   * since it was saved) and any owner that isn't the scratch space or a
   * known current hero. Shared by localStorage restore and file import. */
  function sanitizeLoadouts(raw) {
    const knownHeroIds = new Set(state.heroes.map((h) => h.id));
    const allItemIds = new Set();
    for (const items of Object.values(state.itemsBySlot)) {
      for (const item of items) allItemIds.add(item.id);
    }

    const cleaned = {};
    for (const [owner, loadout] of Object.entries(raw || {})) {
      if (owner !== NO_HERO_OWNER && !knownHeroIds.has(owner)) continue;
      const cleanLoadout = {};
      for (const slot of state.slotOrder) {
        const itemId = loadout && loadout[slot];
        cleanLoadout[slot] = itemId && allItemIds.has(itemId) ? itemId : null;
      }
      cleaned[owner] = cleanLoadout;
    }
    return cleaned;
  }

  function loadSavedLoadouts() {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(LOADOUTS_STORAGE_KEY) || "{}");
    } catch (err) {
      console.warn("Couldn't parse saved loadouts:", err);
      saved = {};
    }
    return sanitizeLoadouts(saved);
  }

  function saveEquipmentData() {
    if (state.isSampleData) return;
    try {
      localStorage.setItem(EQUIPMENT_STORAGE_KEY, JSON.stringify({
        heroes: state.heroes,
        // projected* fields are dropped: they're derived from level/maxLevel/
        // rarity, which are all still here, and annotateProjections() rebuilds
        // them on load. Persisting them would only preserve a stale copy if the
        // curve constants in gear-progression.js are ever corrected.
        equipment: Object.values(state.itemsBySlot).flat().map(stripProjections),
        knownSetSizes: state.knownSetSizes,
      }));
    } catch (err) {
      console.warn("Couldn't save equipment data to localStorage:", err);
    }
  }

  /** Set when loadSavedEquipmentData() throws away a payload it can't use, so
   * init() can say so once there's a UI to say it in. */
  let discardedStaleEquipmentData = false;

  /** Whether a saved payload carries everything the current app reads out of it
   * without re-deriving.
   *
   * Heroes are the fragile half. statTotals is what both Army command
   * (renderArmyCommand) and the breakpoint scale (computeBreakpointScale) gate
   * on, and a hero missing it degrades SILENTLY — the panel just never appears
   * and flat stats quietly fall back to the inventory-max scale, with nothing
   * logged. Better to drop the payload and ask for a re-import than to load it
   * into a half-working app.
   *
   * Equipment is shape-checked only: a stale item scores oddly at worst, it
   * doesn't switch a feature off. */
  function isUsableEquipmentData(data) {
    if (!data || !Array.isArray(data.equipment) || !Array.isArray(data.heroes)) return false;
    return data.heroes.every((hero) => hero && hero.statTotals);
  }

  function loadSavedEquipmentData() {
    try {
      const raw = localStorage.getItem(EQUIPMENT_STORAGE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!isUsableEquipmentData(data)) {
        // Deliberately left in localStorage rather than removed: it's the
        // user's own import, and the next re-import overwrites it anyway.
        discardedStaleEquipmentData = true;
        return null;
      }
      return data;
    } catch (err) {
      console.warn("Couldn't parse saved equipment data:", err);
      return null;
    }
  }

  /** Keep the player on the hero they were looking at across a data swap.
   *
   * A re-export can change a hero's owner id without changing the hero: one
   * whose march and instanced gear differ splits into "<id>::march" and
   * "<id>::instanced", and merges back to a plain "<id>" once they agree (see
   * csv-import.js). Matching on the exact id alone dropped the player to the
   * scratch space on any import that crossed that line — the hero was right
   * there in the list under a neighbouring id. So fall back to the same
   * underlying hero (heroGroupKey) under whatever id this data gives them, and
   * give up only when the hero is genuinely absent.
   *
   * Matched against state.heroes rather than the loadout map so whatever it
   * lands on is always an option in the hero <select>; callers follow with
   * ensureOwnerLoadout to give it a loadout. */
  function retainActiveOwner() {
    if (state.activeOwner === NO_HERO_OWNER) return;
    if (state.heroes.some((h) => h.id === state.activeOwner)) return;
    const group = heroGroupKey(state.activeOwner);
    const sameHero = state.heroes.find((h) => heroGroupKey(h.id) === group);
    state.activeOwner = sameHero ? sameHero.id : NO_HERO_OWNER;
    // The id moved under the player, so the remembered one is now stale —
    // write the new one back or a reload would land on the scratch space.
    saveActiveOwner();
  }

  function applyEquipmentData(data, { isSample }) {
    // Any pending preview belongs to whatever loadout/hero was active in the
    // PREVIOUS session — new data (including a fresh live sync) invalidates it.
    invalidatePendingLiveEquip();
    state.heroes = data.heroes;
    state.itemsBySlot = groupBySlot(annotateProjections(data.equipment));
    state.statScale = computeStatScale(data.equipment);
    state.availableStats = availableStats(data.equipment);
    state.availableRarities = availableRarities(data.equipment);
    refreshBreakpointScale();
    state.knownSetSizes = data.knownSetSizes || {};
    state.isSampleData = isSample;

    if (sampleBannerEl) sampleBannerEl.hidden = !isSample;

    // Drop any active filter/weight for a stat/rarity that no longer exists
    // in the newly loaded inventory, so a stale checked box or weight
    // doesn't linger invisibly.
    const availableSet = new Set(state.availableStats);
    for (const key of [...state.activeStatFilters]) {
      if (!availableSet.has(key)) state.activeStatFilters.delete(key);
    }
    for (const key of Object.keys(state.optimizeWeights)) {
      if (!availableSet.has(key)) delete state.optimizeWeights[key];
    }
    const availableRaritySet = new Set(state.availableRarities);
    for (const rarity of [...state.activeRarityFilters]) {
      if (!availableRaritySet.has(rarity)) state.activeRarityFilters.delete(rarity);
    }

    // Loadouts were sanitized against the PREVIOUS inventory — re-sanitize
    // against the newly loaded one so stale item ids from swapped-out gear
    // don't linger in a loadout.
    state.loadoutsByOwner = sanitizeLoadouts(state.loadoutsByOwner);

    // CSV imports carry each hero's actually-equipped gear — sync every
    // named hero's loadout to match it, overwriting whatever was there.
    if (data.heroLoadouts) {
      for (const [heroId, loadout] of Object.entries(data.heroLoadouts)) {
        state.loadoutsByOwner[heroId] = { ...loadout };
      }
      saveLoadouts();
    }

    if (!isSample) saveEquipmentData();
    else localStorage.removeItem(EQUIPMENT_STORAGE_KEY);

    retainActiveOwner();
    ensureOwnerLoadout(state.activeOwner);
    // The scale refreshed above predates the owner this data resolved to, and
    // it is computed per hero and per loadout — so redo it now both are
    // settled, or the ledger scores the new hero on the old hero's curve.
    refreshBreakpointScale();

    renderHeroSelect();
    renderOptimizeContextSelect();
    // A preset only ever fills in the stats the inventory had AT THE TIME, so
    // one picked before this load is missing every stat only the new data
    // knows about — and the prune above may have just stripped more. Re-apply
    // it against the inventory that's actually loaded now. It repaints the
    // weight list and badge itself, so only do that here when no preset is in
    // force and the weights standing are the player's own.
    if (!reapplyActiveTroopPreset()) {
      // Hand-set weights, so nothing re-derived them — but the prune above may
      // have dropped some, and what's left is what should come back next time.
      saveOptimizeSetup();
      renderOptimizeWeightList();
      updateOptimizeWeightBadge();
    }
    renderFilterMenu();
    updateFilterCountBadge();
    renderSlots();
    refreshTotals();
  }

  function readFileAsJson(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          resolve(JSON.parse(reader.result));
        } catch (err) {
          reject(new Error("That file isn't valid JSON."));
        }
      };
      reader.onerror = () => reject(new Error("Couldn't read that file."));
      reader.readAsText(file);
    });
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Couldn't read that file."));
      reader.readAsText(file);
    });
  }

  /** Shared by the CSV file picker and the paste-CSV textarea — parses the
   * game's own CSV export and loads it the same way a JSON equipment-data
   * file would be, via applyEquipmentData(). */
  function applyCsvText(csvText) {
    let data;
    try {
      data = convertCsvToEquipmentData(csvText);
    } catch (err) {
      showToast(`Couldn't load that CSV: ${err.message}`);
      return false;
    }
    applyEquipmentData(data, { isSample: false });
    state.isLive = false;
    updateLiveEquipButtonVisibility();
    adoptMeasuredGearMultipliers(data.heroes);
    refreshTotals();
    showToast(`Loaded ${data.equipment.length} items, ${data.heroes.length} heroes from CSV — equipped loadouts filled in.`);
    return true;
  }

  async function handleLoadEquipmentCsvFile(file) {
    let text;
    try {
      text = await readFileAsText(file);
    } catch (err) {
      showToast(err.message);
      return;
    }
    applyCsvText(text);
  }

  const SYNC_SERVER_URL = "http://127.0.0.1:5183";

  /** Single entry point for every sync-server request. Throws an Error whose
   * message distinguishes "couldn't reach it at all" (network failure, e.g.
   * nothing listening on the port) from "reached it, but it returned an
   * error" — surfacing the response body's `error` field when there is one,
   * since the most common failure is an expired account token, which comes
   * back as a JSON error from a server that is otherwise running fine. */
  async function fetchFromSyncServer(path, options) {
    let resp;
    try {
      resp = await fetch(`${SYNC_SERVER_URL}${path}`, options);
    } catch (err) {
      throw new Error(`nothing responded at ${SYNC_SERVER_URL} (${err.message}); make sure the sync server is running and reachable`);
    }
    if (!resp.ok) {
      let detail = `HTTP ${resp.status}`;
      try {
        const body = await resp.json();
        if (body && body.error) detail = body.error;
      } catch (_) {
        /* body wasn't JSON, keep the HTTP status detail */
      }
      throw new Error(`the sync server returned an error: ${detail}`);
    }
    try {
      return await resp.json();
    } catch (_) {
      throw new Error("the sync server's response wasn't valid JSON");
    }
  }

  /** Fetches live hero/equipment/loadout data from the local sync server and
   * loads it the same way a CSV or backup file would, via
   * applyEquipmentData(). */
  async function handleSyncGear() {
    let data;
    try {
      data = await fetchFromSyncServer("/api/armory-export");
    } catch (err) {
      showToast(`Couldn't sync — ${err.message}.`);
      return;
    }
    if (!data || !Array.isArray(data.equipment) || !Array.isArray(data.heroes)) {
      showToast("Sync server returned unexpected data — is it running the right version?");
      return;
    }
    data = {
      ...data,
      equipment: data.equipment.map((it) => ({ ...it, stats: nonzeroStats(it.rawStats || {}) })),
    };
    applyEquipmentData(data, { isSample: false });
    state.isLive = true;
    updateLiveEquipButtonVisibility();
    showToast(`Loaded ${data.equipment.length} items, ${data.heroes.length} heroes — equipped loadouts filled in.`);
  }

  /** Sends the active loadout to the sync server's /api/equip. With
   * confirm:false this only computes what WOULD change, without mutating
   * anything — the two-click preview/confirm pattern below relies on that. */
  function postEquip(heroId, loadout, confirm) {
    return fetchFromSyncServer("/api/equip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ heroId, loadout, confirm }),
    });
  }

  function fetchLiveEquipPreview(heroId, loadout) {
    return postEquip(heroId, loadout, false);
  }

  function fetchLiveEquipConfirm(heroId, loadout) {
    return postEquip(heroId, loadout, true);
  }

  function invalidatePendingLiveEquip() {
    pendingLiveEquipPreview = null;
    equipLiveBtnEl.textContent = "Equip this loadout";
  }

  /** The live-equip button only makes sense when data came from a live sync
   * (state.isLive), a real hero is selected, and that hero's loadout has at
   * least one item to send. Called from renderSlots() — the single render
   * chokepoint — so every loadout/hero mutation that ends in a re-render
   * picks this up automatically. */
  function updateLiveEquipButtonVisibility() {
    const hasHero = state.activeOwner !== NO_HERO_OWNER;
    const hasAnyItem = Object.values(activeLoadout()).some((v) => v !== null);
    equipLiveBtnEl.hidden = !(state.isLive && hasHero && hasAnyItem);
    if (equipLiveBtnEl.hidden) invalidatePendingLiveEquip();
  }

  async function handleLiveEquipClick() {
    // Re-entrancy guard: a second click while a request is in flight would
    // otherwise still see pendingLiveEquipPreview truthy (it's only cleared
    // after the await) and fire the mutating confirm POST twice.
    if (equipLiveBtnEl.disabled) return;
    equipLiveBtnEl.disabled = true;

    if (pendingLiveEquipPreview) {
      // Second click: confirm and execute exactly what was previewed.
      const { heroId, loadout } = pendingLiveEquipPreview;
      try {
        const { results } = await fetchLiveEquipConfirm(heroId, loadout);
        const failures = results.filter((r) => !r.success);
        if (failures.length) {
          showToast(`Equipped ${results.length - failures.length} of ${results.length} items. ${failures.length} failed — see console.`);
          console.error("Live equip failures:", failures);
        } else {
          showToast(`Equipped ${results.length} item(s).`);
        }
      } catch (err) {
        console.error(err);
        showToast(`Couldn't equip — ${err.message}.`);
      } finally {
        invalidatePendingLiveEquip();
        equipLiveBtnEl.disabled = false;
      }
      return;
    }

    // First click: preview.
    const heroId = state.activeOwner;
    const loadout = activeLoadout();
    try {
      const { changes, changeCount } = await fetchLiveEquipPreview(heroId, loadout);
      if (changeCount === 0) {
        showToast("Nothing to change — already equipped.");
        return;
      }
      const heroLabel = heroName(heroId);
      const itemList = changes.map((c) => `${c.itemName} (${c.slot})`).join(", ");
      showToast(`This will equip ${changeCount} item(s) to ${heroLabel}: ${itemList}`);
      pendingLiveEquipPreview = { heroId, loadout };
      equipLiveBtnEl.textContent = `Confirm — equip ${changeCount} item(s)`;
    } catch (err) {
      console.error(err);
      showToast(`Couldn't preview the change — ${err.message}.`);
    } finally {
      equipLiveBtnEl.disabled = false;
    }
  }

  /** Validate the shape of a full backup file (heroes + equipment +
   * loadouts together — see exportBackup()). */
  function validateBackupData(data) {
    if (!data || typeof data !== "object") return "Not a valid JSON object.";
    if (!Array.isArray(data.equipment)) return "Missing an \"equipment\" array.";
    if (!Array.isArray(data.heroes)) return "Missing a \"heroes\" array.";
    for (const it of data.equipment) {
      if (!it.id || !it.slot || !it.name) {
        return "An equipment entry is missing id/slot/name.";
      }
    }
    return null;
  }

  /** A backup bundles heroes + equipment + loadouts together, so loading one
   * fully restores a session without needing a separate CSV import first —
   * unlike a loadouts-only snapshot, which can't reintroduce heroes/items
   * that aren't already loaded. */
  async function handleLoadBackupFile(file) {
    let data;
    try {
      data = await readFileAsJson(file);
    } catch (err) {
      showToast(err.message);
      return;
    }
    const error = validateBackupData(data);
    if (error) {
      showToast(`Couldn't load that backup: ${error}`);
      return;
    }
    applyEquipmentData(data, { isSample: false });
    state.isLive = false;
    if (data.gearMultipliers) {
      // A pre-measurement backup carries `heroStatBonus` instead — a single
      // number for what is really three, so there's nothing to migrate. It's
      // ignored, and the next CSV import measures the real ones.
      for (const statKey of Object.keys(BREAKPOINT_STATS)) {
        const clean = sanitizeGearMultiplier(data.gearMultipliers[statKey]);
        if (clean !== null) state.gearMultipliers[statKey] = clean;
      }
      saveGearMultipliers();
      refreshBreakpointScale();
    }
    if (data.troopPriorityPresets) {
      state.customTroopPresets = sanitizeTroopPresets(data.troopPriorityPresets);
      saveTroopPresets();
      updateTroopPresetControls();
    }
    if (data.loadoutsByOwner) {
      state.loadoutsByOwner = sanitizeLoadouts(data.loadoutsByOwner);
      saveLoadouts();
      // retainActiveOwner(), renderHeroSelect() and invalidatePendingLiveEquip()
      // already ran inside applyEquipmentData() above, and nothing since has
      // touched state.heroes, state.activeOwner or the live-equip preview — so
      // re-running them here would just repeat the same result. Only
      // ensureOwnerLoadout/refreshBreakpointScale/renderSlots/refreshTotals need
      // to run again: the loadout map itself just got replaced by the backup's.
      ensureOwnerLoadout(state.activeOwner);
      refreshBreakpointScale();
      renderSlots();
      refreshTotals();
    } else {
      updateLiveEquipButtonVisibility();
    }
    showToast(`Loaded backup: ${data.equipment.length} items, ${data.heroes.length} heroes.`);
  }

  function exportBackup() {
    const blob = new Blob([JSON.stringify({
      heroes: state.heroes,
      equipment: Object.values(state.itemsBySlot).flat().map(stripProjections),
      knownSetSizes: state.knownSetSizes,
      loadoutsByOwner: state.loadoutsByOwner,
      troopPriorityPresets: state.customTroopPresets,
      gearMultipliers: state.gearMultipliers,
    }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tyrant-armory-backup.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast("Backup downloaded.");
  }

  function resetToSampleData() {
    localStorage.removeItem(EQUIPMENT_STORAGE_KEY);
    applyEquipmentData(
      { heroes: SAMPLE_HEROES, equipment: SAMPLE_EQUIPMENT, knownSetSizes: SAMPLE_KNOWN_SET_SIZES },
      { isSample: true }
    );
    state.isLive = false;
    updateLiveEquipButtonVisibility();
    showToast("Reset to sample data.");
  }

  function ensureOwnerLoadout(owner) {
    if (!state.loadoutsByOwner[owner]) {
      const blank = {};
      for (const slot of state.slotOrder) blank[slot] = null;
      state.loadoutsByOwner[owner] = blank;
    }
  }

  function toggleSlotLock(slot) {
    const locked = lockedSlotsForOwner(state.activeOwner);
    if (locked.has(slot)) locked.delete(slot);
    else locked.add(slot);
    saveLockedSlots();
    // Locking/unlocking a slot only affects what auto-optimize is allowed to
    // touch later — it doesn't change any item currently in the active
    // loadout, so a pending preview is still accurate and doesn't need
    // invalidating here.
    renderSlots();
  }

  const slotsEl = document.getElementById("slots");
  const ledgerEl = document.getElementById("ledger");
  const upgradePlanWrapEl = document.getElementById("upgrade-plan-wrap");
  const upgradePlanEl = document.getElementById("upgrade-plan");
  const upgradePlanSummaryEl = document.getElementById("upgrade-plan-summary");
  const upgradePlanBudgetEl = document.getElementById("upgrade-plan-budget");
  const upgradePlanToggleEl = document.getElementById("upgrade-plan-toggle");
  const upgradePlanBodyEl = document.getElementById("upgrade-plan-body");
  const pvpPlanWrapEl = document.getElementById("pvp-plan-wrap");
  const pvpPlanEl = document.getElementById("pvp-plan");
  const pvpPlanSummaryEl = document.getElementById("pvp-plan-summary");
  const pvpPlanToggleEl = document.getElementById("pvp-plan-toggle");
  const pvpPlanBodyEl = document.getElementById("pvp-plan-body");
  const setNotesWrapEl = document.getElementById("set-notes-wrap");
  const setNotesEl = document.getElementById("set-notes");
  const heroSelectEl = document.getElementById("hero-select");
  const optimizeMenuBtnEl = document.getElementById("optimize-menu-btn");
  const optimizeMenuListEl = document.getElementById("optimize-menu-list");
  const optimizeWeightListEl = document.getElementById("optimize-weight-list");
  const optimizeWeightBadgeEl = document.getElementById("optimize-weight-badge");
  const optimizeClearBtnEl = document.getElementById("optimize-clear-btn");
  const optimizeRunBtnEl = document.getElementById("optimize-run-btn");
  const optimizeContextSelectEl = document.getElementById("optimize-context-select");
  const optimizeMaxLevelEl = document.getElementById("optimize-max-level");
  const maxLevelNoticeEl = document.getElementById("max-level-notice");
  const armyCommandWrapEl = document.getElementById("army-command-wrap");
  const armyCommandEl = document.getElementById("army-command");
  const optimizeTroopSelectEl = document.getElementById("optimize-troop-select");
  const optimizeTroopSaveSelectEl = document.getElementById("optimize-troop-save-select");
  const optimizeTroopSaveBtnEl = document.getElementById("optimize-troop-save-btn");
  const optimizeTroopResetBtnEl = document.getElementById("optimize-troop-reset-btn");
  const itemSearchInputEl = document.getElementById("item-search-input");
  const pickerSearchInputEl = document.getElementById("picker-search-input");
  const clearBtnEl = document.getElementById("clear-btn");
  const overlayEl = document.getElementById("picker-overlay");
  const pickerTitleEl = document.getElementById("picker-title");
  const pickerListEl = document.getElementById("picker-list");
  const pickerCloseEl = document.getElementById("picker-close");
  const toastEl = document.getElementById("toast");
  const sampleBannerEl = document.getElementById("sample-banner");
  const dataMenuBtnEl = document.getElementById("data-menu-btn");
  const dataMenuListEl = document.getElementById("data-menu-list");
  const loadLoadoutsBtnEl = document.getElementById("load-loadouts-btn");
  const exportLoadoutsBtnEl = document.getElementById("export-loadouts-btn");
  const resetSampleBtnEl = document.getElementById("reset-sample-btn");
  const loadLoadoutsInputEl = document.getElementById("load-loadouts-input");
  const resetAllHeroesBtnEl = document.getElementById("reset-all-heroes-btn");
  const loadEquipmentCsvBtnEl = document.getElementById("load-equipment-csv-btn");
  const loadEquipmentCsvInputEl = document.getElementById("load-equipment-csv-input");
  const pasteEquipmentCsvBtnEl = document.getElementById("paste-equipment-csv-btn");
  const syncGearBtnEl = document.getElementById("sync-gear-btn");
  const pasteCsvOverlayEl = document.getElementById("paste-csv-overlay");
  const pasteCsvCloseEl = document.getElementById("paste-csv-close");
  const pasteCsvTextareaEl = document.getElementById("paste-csv-textarea");
  const pasteCsvSubmitEl = document.getElementById("paste-csv-submit");
  const filterMenuBtnEl = document.getElementById("filter-menu-btn");
  const filterMenuListEl = document.getElementById("filter-menu-list");
  const filterCheckboxListEl = document.getElementById("filter-checkbox-list");
  const rarityCheckboxListEl = document.getElementById("rarity-checkbox-list");
  const filterClearBtnEl = document.getElementById("filter-clear-btn");
  const filterCountBadgeEl = document.getElementById("filter-count-badge");
  const pickerFilterMenuBtnEl = document.getElementById("picker-filter-menu-btn");
  const pickerFilterMenuListEl = document.getElementById("picker-filter-menu-list");
  const pickerFilterCheckboxListEl = document.getElementById("picker-filter-checkbox-list");
  const pickerFilterClearBtnEl = document.getElementById("picker-filter-clear-btn");
  const pickerFilterCountBadgeEl = document.getElementById("picker-filter-count-badge");
  const compareBtnEl = document.getElementById("compare-btn");
  const equipLiveBtnEl = document.getElementById("equip-live-btn");
  const compareOverlayEl = document.getElementById("compare-overlay");
  const compareCloseEl = document.getElementById("compare-close");
  const compareControlsEl = document.getElementById("compare-controls");
  const compareOwnerAEl = document.getElementById("compare-owner-a");
  const compareOwnerBEl = document.getElementById("compare-owner-b");
  const compareBodyEl = document.getElementById("compare-body");
  const pickerCompareBarEl = document.getElementById("picker-compare-bar");
  const pickerCompareStatusEl = document.getElementById("picker-compare-status");
  const pickerCompareBtnEl = document.getElementById("picker-compare-btn");
  const pickerCompareClearBtnEl = document.getElementById("picker-compare-clear-btn");

  function openMenu(btnEl, listEl) {
    listEl.hidden = false;
    btnEl.setAttribute("aria-expanded", "true");
  }

  function closeMenu(btnEl, listEl) {
    listEl.hidden = true;
    btnEl.setAttribute("aria-expanded", "false");
  }

  function openDataMenu() {
    openMenu(dataMenuBtnEl, dataMenuListEl);
  }

  function closeDataMenu() {
    closeMenu(dataMenuBtnEl, dataMenuListEl);
  }

  function openFilterMenu() {
    openMenu(filterMenuBtnEl, filterMenuListEl);
  }

  function closeFilterMenu() {
    closeMenu(filterMenuBtnEl, filterMenuListEl);
  }

  function openOptimizeMenu() {
    openMenu(optimizeMenuBtnEl, optimizeMenuListEl);
  }

  function closeOptimizeMenu() {
    closeMenu(optimizeMenuBtnEl, optimizeMenuListEl);
  }

  function openPickerFilterMenu() {
    openMenu(pickerFilterMenuBtnEl, pickerFilterMenuListEl);
  }

  function closePickerFilterMenu() {
    closeMenu(pickerFilterMenuBtnEl, pickerFilterMenuListEl);
  }

  function showToast(message) {
    toastEl.textContent = message;
    toastEl.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { toastEl.hidden = true; }, 3200);
  }

  function itemById(slot, id) {
    const items = state.itemsBySlot[slot] || [];
    return items.find((i) => i.id === id) || null;
  }

  function groupBySlot(equipment) {
    const bySlot = {};
    for (const slot of SLOT_ORDER) bySlot[slot] = [];
    for (const it of equipment) {
      if (bySlot[it.slot]) bySlot[it.slot].push(it);
    }
    for (const slot of SLOT_ORDER) {
      bySlot[slot].sort((a, b) => b.level - a.level);
    }
    return bySlot;
  }

  function availableStats(equipment) {
    const present = [];
    for (const key of Object.keys(STAT_LABELS)) {
      if (equipment.some((it) => it.rawStats[key])) present.push(key);
    }
    return present;
  }

  /** Attach each item's level ceiling, how far it still has to climb, and what
   * it would read at that ceiling — the figures the upgrade plan costs its
   * levels against and max-level scoring reads, worked out once at import
   * instead of per item per render.
   *
   * Cached on the item rather than stored: derived entirely from fields already
   * on it, so it's recomputed on load and deliberately stripped before
   * save/export (see saveEquipmentData) instead of being persisted stale. */
  function annotateProjections(equipment) {
    for (const it of equipment) {
      const projection = projectItemToMaxLevel(it);
      it.projectedMaxLevel = projection.maxLevel;
      it.projectedLevelsToGo = projection.levelsToGo;
      it.projectedMaxStats = projection.stats;
      it.projectedMaxStatLines = nonzeroStats(projection.stats);
    }
    return equipment;
  }

  /** The stats every scoring path reads: what an item is worth TODAY, at the
   * level it's actually on — or at its level CAP while max-level scoring is on
   * (see state.maxLevelScoring).
   *
   * Falls back to rawStats for anything with no cached projection, which is
   * what keeps the toggle honest for the synthetic items the scoring code
   * builds out of loose stat dicts (set-bonus ceilings, upgrade-plan
   * what-ifs). Those aren't gear and have no level to project from, so
   * levelling them would be inventing stats out of nothing. */
  function scoreStats(item) {
    if (!item) return {};
    if (state.maxLevelScoring && item.projectedMaxStats) return item.projectedMaxStats;
    return item.rawStats || {};
  }

  /** What an item reads TODAY, whatever the max-level toggle says. For the one
   * caller whose whole subject is the levels the projection assumes bought. */
  function currentStats(item) {
    if (!item) return {};
    return item.rawStats || {};
  }

  /** The pre-formatted stat strings for an item's card, on the same basis the
   * optimizer just scored it — so a piece picked for what it becomes doesn't
   * sit under the numbers it has today. */
  function displayStatLines(item) {
    if (state.maxLevelScoring && item.projectedMaxStatLines) return item.projectedMaxStatLines;
    return item.stats;
  }

  /** An item without its cached projection, for anything that leaves the app
   * (localStorage, backup export). */
  function stripProjections(item) {
    const {
      projectedMaxLevel, projectedLevelsToGo, projectedMaxStats, projectedMaxStatLines, ...rest
    } = item;
    return rest;
  }

  /** Whether a collapsible panel is open. Shared by both plan panels — each
   * remembers its own state under its own key, and an unvisited key falls back
   * to that panel's default rather than to a blanket "closed". */
  function savePanelOpen(storageKey, open) {
    try {
      localStorage.setItem(storageKey, open ? "1" : "0");
    } catch (err) {
      console.warn("Couldn't save the panel preference:", err);
    }
  }

  function loadPanelOpen(storageKey, fallback) {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw === null ? fallback : raw === "1";
    } catch (err) {
      return fallback;
    }
  }

  /** Heading-as-toggle wiring: flip the flag, remember it, repaint that panel. */
  function bindPanelToggle(toggleEl, stateKey, storageKey, render) {
    if (!toggleEl) return;
    toggleEl.addEventListener("click", () => {
      state[stateKey] = !state[stateKey];
      savePanelOpen(storageKey, state[stateKey]);
      render();
    });
  }

  /** Put a panel's heading, body and caret in step with its open state. */
  function applyPanelOpenState(wrapEl, toggleEl, bodyEl, open) {
    if (wrapEl) wrapEl.classList.toggle("is-collapsed", !open);
    if (toggleEl) toggleEl.setAttribute("aria-expanded", open ? "true" : "false");
    if (bodyEl) bodyEl.hidden = !open;
  }

  /** Which hero the player was looking at, so a reload comes back on them
   * rather than on the no-hero scratch space. Only the owner key is kept —
   * the loadout behind it already persists under LOADOUTS_STORAGE_KEY. */
  function saveActiveOwner() {
    try {
      localStorage.setItem(ACTIVE_OWNER_STORAGE_KEY, state.activeOwner);
    } catch (err) {
      console.warn("Couldn't save the selected hero:", err);
    }
  }

  /** The saved owner key, unvalidated: whether that hero still exists is
   * settled by retainActiveOwner, which also handles the march/instanced id
   * split. An absent entry means the scratch space, same as a fresh visit. */
  function loadSavedActiveOwner() {
    try {
      return localStorage.getItem(ACTIVE_OWNER_STORAGE_KEY) || NO_HERO_OWNER;
    } catch (err) {
      return NO_HERO_OWNER;
    }
  }

  /** The auto-optimize setup: the preset the troop dropdown names, the weights
   * standing under it, and the scenario. One record because the three are only
   * meaningful together — weights without their preset label read as hand-set,
   * and a scenario restored without the override bookkeeping behind it
   * (presetAppliedScenario, see there) is one no later preset can undo. */
  function saveOptimizeSetup() {
    try {
      localStorage.setItem(OPTIMIZE_SETUP_STORAGE_KEY, JSON.stringify({
        preset: optimizeTroopSelectEl ? optimizeTroopSelectEl.value : "custom",
        weights: state.optimizeWeights,
        scenario: state.optimizeContext,
        maxLevel: state.maxLevelScoring,
        presetScenario: presetAppliedScenario,
        scenarioBefore: scenarioBeforePreset,
      }));
    } catch (err) {
      console.warn("Couldn't save the auto-optimize setup:", err);
    }
  }

  /** The saved setup with every field validated, or null when there is none.
   * An unknown preset key becomes "custom", which is also what the weights are
   * then read as: the player's own, applied verbatim rather than re-derived. */
  function loadSavedOptimizeSetup() {
    let raw = null;
    try {
      raw = JSON.parse(localStorage.getItem(OPTIMIZE_SETUP_STORAGE_KEY) || "null");
    } catch (err) {
      console.warn("Couldn't parse the saved auto-optimize setup:", err);
    }
    if (!raw || typeof raw !== "object") return null;
    const preset = typeof raw.preset === "string" && raw.preset in TROOP_PRIORITY_PRESETS
      ? raw.preset
      : "custom";
    return {
      preset,
      weights: sanitizeStatWeights(raw.weights),
      scenario: typeof raw.scenario === "string" ? raw.scenario : "general",
      maxLevel: raw.maxLevel === true,
      presetScenario: typeof raw.presetScenario === "string" ? raw.presetScenario : null,
      scenarioBefore: typeof raw.scenarioBefore === "string" ? raw.scenarioBefore : null,
    };
  }

  /** Put the saved setup back into state and onto the troop dropdown, before
   * either select is rendered — renderOptimizeContextSelect reflects the
   * scenario from state, and the dropdown's value decides whether init
   * re-derives the weight list from a preset or takes it as saved.
   *
   * Weights are pruned to the stats this inventory actually has, the same
   * filter applyTroopPreset puts a preset through and for the same reason: the
   * weight list only offers available stats, so anything else would count
   * toward the badge and the scoring while being invisible. */
  function restoreOptimizeSetup() {
    const saved = loadSavedOptimizeSetup();
    if (!saved) return;
    const available = new Set(state.availableStats);
    const weights = {};
    for (const [key, value] of Object.entries(saved.weights)) {
      if (available.has(key)) weights[key] = value;
    }
    state.optimizeWeights = weights;
    state.optimizeContext = saved.scenario;
    state.maxLevelScoring = saved.maxLevel;
    presetAppliedScenario = saved.presetScenario;
    scenarioBeforePreset = saved.scenarioBefore;
    if (optimizeTroopSelectEl) optimizeTroopSelectEl.value = saved.preset;
  }

  function saveUpgradeXpBudget() {
    try {
      localStorage.setItem(UPGRADE_BUDGET_STORAGE_KEY, String(state.upgradeXpBudget || 0));
    } catch (err) {
      console.warn("Couldn't save the upgrade XP budget:", err);
    }
  }

  function loadSavedUpgradeXpBudget() {
    try {
      const raw = Number(localStorage.getItem(UPGRADE_BUDGET_STORAGE_KEY));
      return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_UPGRADE_XP_BUDGET;
    } catch (err) {
      return DEFAULT_UPGRADE_XP_BUDGET;
    }
  }

  /** Per-stat normalization reference: the largest absolute value each stat
   * reaches anywhere in the inventory. weightedScore divides each raw stat by
   * this before applying its weight, so a weight of 1 means the same "how much
   * I care" whether the stat is a flat value in the thousands (attack) or a
   * fraction of a percent (pvpAttack). Without it a weight just scales the
   * stat's raw magnitude, so big-number stats swamp small-number ones no
   * matter what weights you pick. */
  function computeStatScale(equipment) {
    const scale = {};
    for (const it of equipment) {
      for (const [key, value] of Object.entries(scoreStats(it))) {
        const mag = Math.abs(value);
        if (mag > (scale[key] || 0)) scale[key] = mag;
      }
    }
    return scale;
  }

  /** Every item in the inventory, back out of the per-slot buckets. */
  function allEquipment() {
    return state.slotOrder.flatMap((slot) => state.itemsBySlot[slot] || []);
  }

  /** Re-read the per-stat normalization references from the inventory as it
   * currently scores. Needed on a data load (new items, new maxima) and on a
   * max-level toggle (same items, different stats) — without it a weight of 1
   * keeps meaning what it meant against the old basis. */
  function refreshStatScale() {
    state.statScale = computeStatScale(allEquipment());
  }

  function activeHero() {
    if (state.activeOwner === NO_HERO_OWNER) return null;
    return state.heroes.find((h) => h.id === state.activeOwner) || null;
  }

  /** A percentage roll to measure the flat stats against when the inventory
   * has no percentage twin to calibrate from — see computeBreakpointScale.
   * 2% is a typical strong roll on a single piece. */
  const NOMINAL_PERCENT_ROLL = 0.02;

  /** What a hero's Attack/Defence/Health would actually read if `gearNow` were
   * equipped instead of whatever the export caught them wearing.
   *
   * The exported hero_stats has the account's multipliers already baked in:
   *
   *     hero_stats = (gearless base + equipped gear x equipBonus) x research
   *
   * so swapping gear moves the total by the DIFFERENCE, itself multiplied by
   * the two compounded — which is what gearMultiplierFor() returns:
   *
   *     total = hero_stats + (gearNow - equippedGear) x gearMultiplier[stat]
   *
   * Written this way the gearless base never has to be materialised, and
   * re-equipping the same gear reproduces hero_stats exactly whatever the
   * multiplier is — so a wrong multiplier can't silently corrupt the starting
   * point, it only changes how much a swap is worth.
   *
   * That the multipliers lift GEAR as well as the hero is measured, not
   * assumed. Three heroes with a known gearless curve were each given a single
   * item: hero_stats moved by exactly the item's raw stats times 1.2190 on
   * attack and defence and 1.1960 on health, agreeing to five significant
   * figures across all nine readings. Those are 1.15 x 1.06 and 1.15 x 1.04 —
   * the Equipment Stat Bonus and the per-stat Hero Research. The rival reading,
   * where gear goes in unmultiplied, is off by a fifth.
   *
   * This is the one place the multiplier could NOT be traded for a preset
   * weight. A weight scales a score; this decides which NUMBER the hero ends up
   * reading, and that number is then fed through a curve that bends. Drop the
   * multiplier here and a 100k-to-150k gear swap projects +50,000 where the
   * game will show +60,950 — so the curve gets sampled at the wrong point and
   * the cap gets missed — and no weight downstream can undo it. */
  function heroStatTotalsFor(hero, gearNow) {
    const totals = {};
    for (const statKey of Object.keys(BREAKPOINT_STATS)) {
      const carried = (hero.equippedGearTotals && hero.equippedGearTotals[statKey]) || 0;
      const swing = ((gearNow && gearNow[statKey]) || 0) - carried;
      const total = ((hero.statTotals && hero.statTotals[statKey]) || 0)
        + swing * gearMultiplierFor(statKey);
      totals[statKey] = Math.max(0, total);
    }
    return totals;
  }

  /** Divisors that put flat attack/defense/health into the SAME unit
   * weightedScore already uses for attackPercent/defensePercent/healthPercent,
   * so a weight of 1 on each means the same thing.
   *
   * A flat stat's real worth is the troop buff it buys, and that runs through
   * the hero's rarity breakpoint curve (hero-breakpoints.js): the curve
   * flattens as the stat climbs, and stops paying out entirely at the cap. So
   * +20,000 Attack is worth a lot on a hero at 200k and literally nothing on
   * one already capped — which the old inventory-max divisor had no way to
   * express, and which is why the built-in presets had to park attack/defense/
   * health at weight 1 to keep them from distorting the result.
   *
   * The divisor is built so that rawStat / divisor lands on "buff bought, as a
   * multiple of one inventory-best percentage roll" — exactly what
   * percentStat / statScale[percentStat] already computes for the percentage
   * twin. A hero already at a stat's cap gets an infinite divisor, scoring that
   * stat at a flat zero — which is the literal truth, and something the
   * inventory scale could never say. Stats left out entirely (unknown rarity,
   * or a hero with no recorded stat totals) fall back to the inventory scale, so
   * scoring degrades to the old behaviour rather than breaking.
   *
   * The gear multiplier used to enter here as well, scaling what each raw
   * point is worth. It now rides on the preset weights instead — see
   * scenarioWeights — which puts it next to troop affinity where both are
   * visible in one table. It still enters via heroStatTotalsFor, because
   * WHERE the hero stands on the curve is a fact about the game and not a
   * weighting; that one can't move.
   *
   * `loadout` is the gear the hero is standing in while the slope is read.
   * Defaults to what they're actually wearing, which is what the ledger and the
   * item list want; auto-optimize passes a hypothetical one to re-read the
   * slope from where a candidate loadout would put them (see optimizeLoadout).
   */
  function computeBreakpointScale(loadout) {
    const hero = activeHero();
    if (!hero || !hero.statTotals) return {};
    const rarity = hero.rarity || DEFAULT_HERO_RARITY;
    const gear = combinedStatsForLoadout(loadout || activeLoadout() || {});
    const totals = heroStatTotalsFor(hero, gear);
    const scale = {};
    for (const [statKey, { kind, percentKey }] of Object.entries(BREAKPOINT_STATS)) {
      const perPoint = heroStatMarginalPerPoint(rarity, kind, totals[statKey]);
      if (!perPoint) {
        // Capped: more of this flat stat buys this hero nothing at all, so it
        // must score zero however heavily it's weighted. Dividing by Infinity
        // is how that's said in the units weightedScore works in.
        scale[statKey] = Infinity;
        continue;
      }
      const percentRef = state.statScale[percentKey] || NOMINAL_PERCENT_ROLL;
      scale[statKey] = percentRef / perPoint;
    }
    return scale;
  }

  function refreshBreakpointScale() {
    state.breakpointScale = computeBreakpointScale();
  }

  function hasActiveFilters() {
    return state.activeStatFilters.size > 0 || state.activeRarityFilters.size > 0
      || state.globalSearchQuery !== "";
  }

  /** Rarity filter is ANY-match against activeRarityFilters, stat filter is
   * ANY-match against activeStatFilters, name search is a substring match —
   * all three combine via AND, e.g. rarity={EPIC} + stats={pvpAttack,pvpDefense}
   * + search="pouch" matches an EPIC item named like "pouch" with EITHER pvp
   * stat. Any axis being empty/unset means that axis is unrestricted. */
  function itemMatchesActiveFilters(item) {
    if (state.activeRarityFilters.size > 0 && !state.activeRarityFilters.has(item.rarity)) {
      return false;
    }
    if (state.activeStatFilters.size > 0) {
      let matchesAnyStat = false;
      for (const key of state.activeStatFilters) {
        if (item.rawStats[key]) { matchesAnyStat = true; break; }
      }
      if (!matchesAnyStat) return false;
    }
    if (state.globalSearchQuery && !item.name.toLowerCase().includes(state.globalSearchQuery)) {
      return false;
    }
    return true;
  }

  /** The picker's OWN stat filter — separate from the global topbar Filter
   * menu, narrows just the currently-open slot's list. ANY-match, same
   * shape as the global stat filter. Empty = unrestricted. */
  function itemMatchesPickerStatFilter(item) {
    if (state.pickerStatFilters.size === 0) return true;
    for (const key of state.pickerStatFilters) {
      if (item.rawStats[key]) return true;
    }
    return false;
  }

  function slotMatchCount(slot) {
    if (!hasActiveFilters()) return null;
    const items = state.itemsBySlot[slot] || [];
    return items.filter(itemMatchesActiveFilters).length;
  }

  /** `statsOf` picks the basis: scoreStats (whatever the max-level toggle says)
   * for everything on screen, currentStats for the upgrade plan. */
  function sumStats(items, statsOf = scoreStats) {
    const totals = {};
    for (const key of Object.keys(STAT_LABELS)) totals[key] = 0;
    for (const it of items) {
      const stats = statsOf(it);
      for (const key of Object.keys(STAT_LABELS)) {
        totals[key] += stats[key] || 0;
      }
    }
    return totals;
  }

  function selectedItemsForLoadout(loadout) {
    const selected = [];
    for (const slot of SLOT_ORDER) {
      const it = loadout[slot] ? itemById(slot, loadout[slot]) : null;
      if (it) selected.push(it);
    }
    return selected;
  }

  /** Gear stats + active set bonuses combined into one raw dict (all
   * STAT_LABELS keys present, including zeros) — the shared basis for both
   * the ledger display and loadout-vs-loadout comparison. */
  function combinedStatsForLoadout(loadout, statsOf = scoreStats) {
    const selected = selectedItemsForLoadout(loadout);
    const gearTotals = sumStats(selected, statsOf);
    const setBonusTotals = computeActiveSetBonusStats(selected);
    const combined = { ...gearTotals };
    for (const [key, value] of Object.entries(setBonusTotals)) {
      combined[key] = (combined[key] || 0) + value;
    }
    return combined;
  }

  function computeTotals(loadout) {
    const selected = selectedItemsForLoadout(loadout);
    const combined = combinedStatsForLoadout(loadout);

    const rows = [];
    for (const key of Object.keys(STAT_LABELS)) {
      const value = combined[key] || 0;
      if (value) rows.push({ key, label: STAT_LABELS[key], text: fmtStat(key, value) });
    }
    const setNotes = buildSetNotes(selected, state.knownSetSizes);
    return { totals: rows, setNotes };
  }

  /** An item's optimize score is the weighted sum of its stats, each
   * NORMALIZED by that stat's inventory-wide scale (see computeStatScale) so
   * weights are comparable across stats of wildly different magnitude — a
   * weight of 2 on a flat stat and 1.5 on a percentage stat now mean what you'd
   * expect, instead of the flat stat winning on raw size alone. A single stat
   * at weight 1 with everything else 0 still behaves exactly like the old
   * single-stat optimize (a constant per-stat divisor can't change which item
   * ranks highest). Falls back to a divisor of 1 for any stat with no known
   * scale, so scoring never divides by zero.
   *
   * `skipKeys` drops stats from the sum entirely, for callers that score those
   * stats some other way — see totalScoreForLoadout, which scores the three
   * breakpoint stats exactly instead of linearly. */
  function weightedScore(rawStats, weights, skipKeys) {
    const scale = state.statScale || {};
    const breakpoint = state.breakpointScale || {};
    let score = 0;
    for (const [key, weight] of Object.entries(weights)) {
      if (!weight) continue;
      if (skipKeys && skipKeys.has(key)) continue;
      const ref = breakpoint[key] || scale[key] || 1;
      score += weight * ((rawStats[key] || 0) / ref);
    }
    return score;
  }

  const BREAKPOINT_STAT_KEYS = new Set(Object.keys(BREAKPOINT_STATS));

  /** What a WHOLE loadout's flat Attack/Defence/Health is worth to the active
   * hero, read straight off the breakpoint curve instead of off the linear
   * divisor — the difference between the buff they'd have wearing `gearStats`
   * and the buff they'd have wearing nothing.
   *
   * weightedScore has to linearize: it ranks one item at a time with no idea
   * what else ends up equipped, so it reads a single slope and holds it. That's
   * fine per item and wrong per loadout — six slots of Attack move the hero far
   * enough along the curve that the slope at the start overstates what the last
   * pieces buy, and it can't see the cap coming at all. Here the whole loadout
   * is known, so the exact stepped answer is available and the cap is a real
   * wall rather than something the linearization walks through.
   *
   * The units match weightedScore's by construction. Dividing by the gear
   * multiplier undoes the one the preset weights carry (see scenarioWeights),
   * leaving buff-per-raw-gear-point measured against one inventory-best
   * percentage roll — exactly what `raw / breakpointScale[stat]` computes. Over
   * a range where the curve is straight the two agree to the digit; they part
   * company precisely where the linearization was lying.
   *
   * Returns null when there's no hero to run a curve for, so callers fall back
   * to the linear path rather than silently scoring these stats at zero. */
  function exactBreakpointScore(gearStats, weights) {
    const hero = activeHero();
    if (!hero || !hero.statTotals) return null;
    const rarity = hero.rarity || DEFAULT_HERO_RARITY;
    const bare = heroStatTotalsFor(hero, {});
    const geared = heroStatTotalsFor(hero, gearStats);
    let score = 0;
    for (const [statKey, { kind, percentKey }] of Object.entries(BREAKPOINT_STATS)) {
      const weight = weights[statKey];
      if (!weight) continue;
      const gain = heroStatPercent(rarity, kind, geared[statKey])
        - heroStatPercent(rarity, kind, bare[statKey]);
      const percentRef = state.statScale[percentKey] || NOMINAL_PERCENT_ROLL;
      score += weight * gain / (gearMultiplierFor(statKey) * percentRef);
    }
    return score;
  }

  function bestItemForWeights(candidates, weights) {
    if (!candidates.length) return null;
    let best = candidates[0];
    let bestScore = weightedScore(scoreStats(best), weights);
    for (const c of candidates) {
      const score = weightedScore(scoreStats(c), weights);
      if (score > bestScore) { best = c; bestScore = score; }
    }
    return best;
  }

  /** Locked slots keep whatever's in currentLoadout untouched; every other
   * slot is picked fresh by weighted score. */
  function pickBestPerSlot(itemsBySlot, weights, excludeIds, currentLoadout, lockedSlots) {
    const loadout = {};
    for (const slot of SLOT_ORDER) {
      if (lockedSlots.has(slot)) {
        loadout[slot] = currentLoadout[slot] || null;
        continue;
      }
      const candidates = (itemsBySlot[slot] || []).filter((it) => !excludeIds.has(it.id));
      const best = bestItemForWeights(candidates, weights);
      loadout[slot] = best ? best.id : null;
    }
    return loadout;
  }

  /** Score a COMPLETE loadout — gear plus whatever set bonuses it lights up in
   * the active scenario. Everything but the three breakpoint stats is the plain
   * linear sum weightedScore would give (it's linear in rawStats, so summing
   * per item and scoring the combined total are the same number); those three
   * go through exactBreakpointScore, which knows the whole loadout and so can
   * charge the curve honestly.
   *
   * That split makes this value independent of state.breakpointScale, which is
   * what lets optimizeLoadout compare candidates found under different slopes. */
  function totalScoreForLoadout(itemsBySlot, loadout, weights) {
    const selected = [];
    for (const slot of SLOT_ORDER) {
      const itemId = loadout[slot];
      if (!itemId) continue;
      const item = (itemsBySlot[slot] || []).find((it) => it.id === itemId);
      if (item) selected.push(item);
    }
    const combined = sumStats(selected);
    const setBonus = computeActiveSetBonusStats(selected, state.optimizeContext);
    for (const [key, value] of Object.entries(setBonus)) {
      combined[key] = (combined[key] || 0) + value;
    }
    const exact = exactBreakpointScore(combined, weights);
    if (exact === null) return weightedScore(combined, weights);
    return exact + weightedScore(combined, weights, BREAKPOINT_STAT_KEYS);
  }

  /** Greedy per-slot pick (pickBestPerSlot) only maximizes raw item stats —
   * it has no way to discover that swapping a slightly-lower-score item for
   * a set piece unlocks a set bonus that raises the TOTAL (gear + bonus)
   * higher than the pure-greedy pick. This tries, for every known set, the
   * cheapest way to hit each of its bonus tiers (swap only the UNLOCKED
   * slots where the set piece costs the least score vs. the greedy pick —
   * cost is always >= 0 since greedy already chose the best item per slot),
   * and keeps whichever candidate (including plain greedy) scores highest. */
  function pickBestPerSlotWithSetBonuses(itemsBySlot, weights, excludeIds, currentLoadout, lockedSlots) {
    const baselineLoadout = pickBestPerSlot(itemsBySlot, weights, excludeIds, currentLoadout, lockedSlots);
    let bestLoadout = baselineLoadout;
    let bestValue = totalScoreForLoadout(itemsBySlot, baselineLoadout, weights);

    const greedyBestBySlot = {};
    for (const slot of SLOT_ORDER) {
      if (lockedSlots.has(slot)) continue;
      const candidates = (itemsBySlot[slot] || []).filter((it) => !excludeIds.has(it.id));
      greedyBestBySlot[slot] = bestItemForWeights(candidates, weights);
    }

    for (const setId of Object.keys(SET_BONUS_DEFS)) {
      const def = SET_BONUS_DEFS[setId];
      // No point chasing a set bonus that won't count in the active scenario —
      // totalScoreForLoadout would ignore it, so it can only cost score.
      if (!setBonusAppliesInContext(def, state.optimizeContext)) continue;

      const setBestBySlot = {};
      for (const slot of SLOT_ORDER) {
        if (lockedSlots.has(slot)) continue;
        const candidates = (itemsBySlot[slot] || []).filter(
          (it) => !excludeIds.has(it.id) && it.setId === setId
        );
        const best = bestItemForWeights(candidates, weights);
        if (best) setBestBySlot[slot] = best;
      }
      const ownedSlots = Object.keys(setBestBySlot);
      if (!ownedSlots.length) continue;

      const costs = ownedSlots
        .map((slot) => {
          const greedyItem = greedyBestBySlot[slot];
          const greedyVal = greedyItem ? weightedScore(scoreStats(greedyItem), weights) : 0;
          const setVal = weightedScore(scoreStats(setBestBySlot[slot]), weights);
          return { slot, cost: greedyVal - setVal };
        })
        .sort((a, b) => a.cost - b.cost);

      for (const tier of def.tiers) {
        const count = tier.pieces;
        if (count > ownedSlots.length) continue;

        const candidateLoadout = { ...baselineLoadout };
        for (const { slot } of costs.slice(0, count)) {
          candidateLoadout[slot] = setBestBySlot[slot].id;
        }

        const value = totalScoreForLoadout(itemsBySlot, candidateLoadout, weights);
        if (value > bestValue) {
          bestValue = value;
          bestLoadout = candidateLoadout;
        }
      }
    }

    return bestLoadout;
  }

  function loadoutKey(loadout) {
    return SLOT_ORDER.map((slot) => loadout[slot] || "").join("|");
  }

  /** An item's value measured from the BARE hero — the most any loadout could
   * possibly get out of it, and the bound the whole search rests on.
   *
   * The breakpoint curve is concave, so the buff a lump of flat stat buys is
   * biggest when it's added first and only shrinks as other pieces push the
   * hero further along. Measure every item from the same bare starting point
   * and the individual gains necessarily add up to at least the gain of putting
   * them all on together. The rest of the score is linear, where the two are
   * equal. So this over-estimates, never under-estimates — which is exactly
   * what an admissible bound has to do. */
  function optimisticItemValue(item, weights) {
    const stats = scoreStats(item);
    const exact = exactBreakpointScore(stats, weights);
    if (exact === null) return weightedScore(stats, weights);
    return exact + weightedScore(stats, weights, BREAKPOINT_STAT_KEYS);
  }

  /** Every set bonus in the game that could apply in this scenario, all tiers,
   * all at once — the most set bonuses could possibly be worth to any loadout.
   * Deliberately crude: no six-slot loadout can light all of them, but this is a
   * constant, it's provably not an under-estimate, and set bonuses are small
   * enough next to gear stats that tightening it wouldn't buy much pruning. */
  function setBonusCeiling(weights) {
    const totals = {};
    for (const def of Object.values(SET_BONUS_DEFS)) {
      if (!setBonusAppliesInContext(def, state.optimizeContext)) continue;
      for (const tier of def.tiers) {
        for (const [key, value] of Object.entries(tier.bonuses)) {
          totals[key] = (totals[key] || 0) + value;
        }
      }
    }
    return optimisticItemValue({ rawStats: totals }, weights);
  }

  /** Whether `a` is at least as good as `b` on every stat carrying a weight. */
  function weaklyBeatsOn(a, b, keys) {
    for (const key of keys) {
      if ((scoreStats(a)[key] || 0) < (scoreStats(b)[key] || 0)) return false;
    }
    return true;
  }

  /** Whether putting `a` in the slot instead of `b` can't cost a set bonus:
   * either they belong to the same set, or `b` belongs to none. Anything else
   * would drop b's set a piece, which the stat comparison can't see. */
  function setSafeSwap(a, b) {
    return a.setId === b.setId || !b.setId;
  }

  /** Items that cannot appear in the best answer for their slot, removed before
   * the search ever sees them.
   *
   * `b` is dominated by `a` when `a` matches or beats it on every weighted stat
   * and the swap is set-safe. Three facts make that sound, and all three are
   * enforced elsewhere: weights are always positive (the weight input rejects
   * anything else), item stats are never negative, and set tiers only ever add
   * bonuses. So the swap can only move the score up, and `b` is never needed.
   *
   * This is what keeps the search finite in practice. Real inventories are
   * mostly strictly-worse copies of the same few shapes — the same item at a
   * lower level, the same roll at lower quality — and every one of those
   * collapses here rather than multiplying out across six slots.
   *
   * Items identical on every weighted stat dominate each other; the tie goes to
   * the earlier one so a pair can't delete itself. */
  function prunedCandidates(candidates, weights) {
    const keys = Object.keys(weights).filter((key) => weights[key]);
    if (!keys.length) return candidates;
    const kept = [];
    for (let i = 0; i < candidates.length; i++) {
      const item = candidates[i];
      let dominated = false;
      for (let j = 0; j < candidates.length && !dominated; j++) {
        if (i === j) continue;
        const other = candidates[j];
        if (!setSafeSwap(other, item) || !weaklyBeatsOn(other, item, keys)) continue;
        const mutual = setSafeSwap(item, other) && weaklyBeatsOn(item, other, keys);
        if (mutual && j > i) continue;
        dominated = true;
      }
      if (!dominated) kept.push(item);
    }
    return kept;
  }

  /** The three breakpoint stats in a fixed order, so the search can carry their
   * running totals in a plain 3-array instead of an object. */
  const BREAKPOINT_STAT_ORDER = Object.keys(BREAKPOINT_STATS);

  /** exactBreakpointScore's arithmetic with everything that can't change during
   * a search hoisted out of the loop, reduced to a function of the loadout's
   * three summed flat stats.
   *
   * Same formula, same result — the hero's bare totals, their bare buff, the
   * gear multipliers and the percentage references are all fixed for the whole
   * search, so recomputing them per candidate loadout was most of the cost.
   * What's left per call is three curve evaluations.
   *
   * Returns null when there's no hero, matching exactBreakpointScore.
   *
   * Nothing HOLDS the two in step — there are no tests in this repo — so any
   * edit to one is an edit to both. The clamp is the easy one to get wrong: the
   * bare reading and the geared one must clamp at the same point, which is why
   * `base` is kept unclamped here and Math.max(0, ...) is applied twice at the
   * point of use rather than once when base is computed. Let them drift and the
   * search silently optimizes a different objective from the one the ledger and
   * the incumbent are scored on — no error, just a wrong answer that still
   * reports itself as "best of N combinations". */
  function makeFlatScorer(weights) {
    const hero = activeHero();
    if (!hero || !hero.statTotals) return null;
    const rarity = hero.rarity || DEFAULT_HERO_RARITY;
    const terms = [];
    for (let i = 0; i < BREAKPOINT_STAT_ORDER.length; i++) {
      const statKey = BREAKPOINT_STAT_ORDER[i];
      const weight = weights[statKey];
      if (!weight) continue;
      const { kind, percentKey } = BREAKPOINT_STATS[statKey];
      const mult = gearMultiplierFor(statKey);
      const carried = (hero.equippedGearTotals && hero.equippedGearTotals[statKey]) || 0;
      // The hero with this gear taken off, unclamped — heroStatTotalsFor's
      // arithmetic, with the clamp deferred to the point of use so the bare
      // reading and the geared one clamp the same way.
      const base = ((hero.statTotals && hero.statTotals[statKey]) || 0) - carried * mult;
      const percentRef = state.statScale[percentKey] || NOMINAL_PERCENT_ROLL;
      terms.push({
        index: i,
        kind,
        base,
        mult,
        barePercent: heroStatPercent(rarity, kind, Math.max(0, base)),
        coefficient: weight / (mult * percentRef),
      });
    }
    return (flats) => {
      let score = 0;
      for (const term of terms) {
        const total = Math.max(0, term.base + flats[term.index] * term.mult);
        score += term.coefficient
          * (heroStatPercent(rarity, term.kind, total) - term.barePercent);
      }
      return score;
    };
  }

  /** Leaf budget — a backstop, not the normal path. A leaf is a complete
   * loadout getting scored, at roughly 0.2µs each, so this caps a run at about
   * a third of a second.
   *
   * Realistic inventories never come near it: 150 candidates per slot is 1.1e13
   * combinations and the bound settles it in single-digit leaves, because gear
   * varies enough that most of it is provably beaten. What burns the budget is
   * an inventory where everything is nearly equal in value but on different
   * stats, so nothing dominates and the bound can't separate anything — then
   * the search really does have to look at combinations one at a time, and
   * saying so is better than hanging. */
  const OPTIMIZE_MAX_LEAVES = 2000000;

  /** Exhaustive search over whole loadouts, which is what the greedy per-slot
   * pick can't do.
   *
   * Greedy is only correct when slots are independent, and here they aren't,
   * twice over. Set bonuses pay for a PATTERN across slots, so the best piece
   * for a slot depends on what the other five are. And the breakpoint curve
   * charges the SUM of flat Attack/Defence/Health, so the sixth piece of attack
   * is worth less than the first and may be worth nothing — again a fact about
   * the whole loadout, not the slot. pickBestPerSlotWithSetBonuses papers over
   * the first with a hand-rolled "try each set's cheapest tier" special case and
   * over the second not at all.
   *
   * So: branch and bound over every combination. Depth-first, one slot per
   * level, candidates within a slot sorted by optimisticItemValue descending.
   * At each node the best the subtree could possibly reach is
   *
   *     (optimistic value of what's chosen so far)
   *   + (per-slot best optimistic value for every slot still to come)
   *   + setBonusCeiling
   *
   * every term of which is an over-estimate, so a node whose bound can't beat
   * the incumbent has no answer in it and the whole subtree is dropped. Since
   * candidates are sorted, the first candidate that fails the bound means every
   * later one fails too — hence `break`, which is where the pruning power comes
   * from.
   *
   * Scoring a leaf is the same arithmetic totalScoreForLoadout does, taken
   * apart so nothing is recomputed that didn't change. An item's non-breakpoint
   * score is additive, so it's worked out once per item and summed on the way
   * down; the three flat stats aren't additive in score (that's the whole
   * point) but their RAW values are, so those are summed on the way down too
   * and put through the curve once at the bottom. Set bonuses depend only on
   * how many pieces of each set are on, so they're keyed by that and memoized.
   * Nothing in here depends on state.breakpointScale.
   *
   * Seeded with the greedy answer as the incumbent, so a search that runs out
   * of budget still returns something at least as good as before, and the
   * result is never worse than what the old code produced. */
  function searchBestLoadout(itemsBySlot, weights, excludeIds, currentLoadout, lockedSlots, seed) {
    const flatScorer = makeFlatScorer(weights);
    // Set ids get interned to indices so a loadout's set composition can be
    // carried as one number: base-7 digits, one per set, each counting pieces
    // (six slots, so a digit can't carry). That makes the memo key a plain
    // integer the descent adds to and subtracts from, instead of a string to
    // rebuild at every leaf.
    //
    // Only sets with a bonus definition get a digit — an item in an unknown set
    // can't change what the bonuses are worth, so it shares the zero key. That
    // also bounds the arithmetic: it takes 19 defined sets to push 7^n past
    // exact integer range, against the four that exist.
    const setIndex = new Map();
    const setPlace = [];
    function setKeyFor(setId) {
      if (!setId || !SET_BONUS_DEFS[setId]) return 0;
      if (!setIndex.has(setId)) {
        setIndex.set(setId, setPlace.length);
        setPlace.push(Math.pow(7, setPlace.length));
      }
      return setPlace[setIndex.get(setId)];
    }

    /** An item reduced to what the inner loop needs. */
    function profile(item) {
      const itemStats = scoreStats(item);
      const flats = BREAKPOINT_STAT_ORDER.map((key) => itemStats[key] || 0);
      return {
        id: item.id,
        item,
        flats,
        linear: weightedScore(itemStats, weights, BREAKPOINT_STAT_KEYS),
        setKey: setKeyFor(item.setId),
        value: optimisticItemValue(item, weights),
      };
    }

    const fixed = {};
    const fixedItems = [];
    const open = [];
    let fixedValue = 0;
    let fixedLinear = 0;
    let fixedSetKey = 0;
    const fixedFlats = [0, 0, 0];
    let combinations = 1;

    for (const slot of SLOT_ORDER) {
      if (lockedSlots.has(slot)) {
        const itemId = currentLoadout[slot] || null;
        fixed[slot] = itemId;
        const item = itemId ? (itemsBySlot[slot] || []).find((it) => it.id === itemId) : null;
        if (item) {
          const p = profile(item);
          fixedItems.push(item);
          fixedValue += p.value;
          fixedLinear += p.linear;
          fixedSetKey += p.setKey;
          for (let k = 0; k < 3; k++) fixedFlats[k] += p.flats[k];
        }
        continue;
      }
      const available = (itemsBySlot[slot] || []).filter((it) => !excludeIds.has(it.id));
      const candidates = prunedCandidates(available, weights)
        .map(profile)
        .sort((a, b) => b.value - a.value);
      // Leaving a slot empty is never better than filling it: stats are
      // non-negative, weights positive, set bonuses additive. So an empty slot
      // here means there was genuinely nothing to put in it.
      if (!candidates.length) { fixed[slot] = null; continue; }
      open.push({ slot, candidates });
      combinations *= candidates.length;
    }

    // Decide slots where the choice matters most first, so a wrong turn is
    // caught at shallow depth and takes a bigger subtree down with it.
    open.sort((a, b) => {
      const spreadA = a.candidates[0].value - a.candidates[a.candidates.length - 1].value;
      const spreadB = b.candidates[0].value - b.candidates[b.candidates.length - 1].value;
      return spreadB - spreadA;
    });

    const depth = open.length;
    const suffix = new Array(depth + 1).fill(0);
    for (let i = depth - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + open[i].candidates[0].value;

    // Set composition -> what those bonuses are worth, split the same way an
    // item is. Every loadout sharing a composition shares this, and most do.
    // Locked slots count towards the composition, so their items go in too.
    const setMemo = new Map();
    function setBonusProfile(key, chosen, count) {
      let hit = setMemo.get(key);
      if (hit) return hit;
      const items = fixedItems.slice();
      for (let k = 0; k < count; k++) items.push(chosen[k].item);
      const totals = computeActiveSetBonusStats(items, state.optimizeContext);
      hit = {
        linear: weightedScore(totals, weights, BREAKPOINT_STAT_KEYS),
        flats: BREAKPOINT_STAT_ORDER.map((statKey) => totals[statKey] || 0),
      };
      setMemo.set(key, hit);
      return hit;
    }

    const ceiling = setBonusCeiling(weights);
    const chosen = new Array(depth).fill(null);
    let best = { ...seed };
    let bestValue = totalScoreForLoadout(itemsBySlot, best, weights);
    let leaves = 0;
    let exhaustive = true;

    const flats = [0, 0, 0];
    const withBonus = [0, 0, 0];

    function descend(i, prefix, linear, setKey) {
      if (i === depth) {
        const bonus = setBonusProfile(setKey, chosen, depth);
        let value = linear + bonus.linear;
        if (flatScorer) {
          for (let k = 0; k < 3; k++) withBonus[k] = flats[k] + bonus.flats[k];
          value += flatScorer(withBonus);
        }
        if (value > bestValue) {
          bestValue = value;
          best = { ...fixed };
          for (let k = 0; k < depth; k++) best[open[k].slot] = chosen[k].id;
        }
        if (++leaves >= OPTIMIZE_MAX_LEAVES) exhaustive = false;
        return;
      }
      for (const entry of open[i].candidates) {
        if (prefix + entry.value + suffix[i + 1] + ceiling <= bestValue) break;
        chosen[i] = entry;
        for (let k = 0; k < 3; k++) flats[k] += entry.flats[k];
        descend(i + 1, prefix + entry.value, linear + entry.linear, setKey + entry.setKey);
        for (let k = 0; k < 3; k++) flats[k] -= entry.flats[k];
        if (!exhaustive) return;
      }
    }

    if (depth) {
      for (let k = 0; k < 3; k++) flats[k] = fixedFlats[k];
      descend(0, fixedValue, fixedLinear, fixedSetKey);
    }
    return { loadout: best, exhaustive, leaves, combinations };
  }

  /** How many times auto-optimize will re-read the breakpoint slopes and try
   * again. Passes past the first are cheap relative to how often anyone clicks
   * optimize, and in practice it settles in two — the third is there for the
   * case where the second pass shifts a set bonus and moves the totals again. */
  const OPTIMIZE_RESCALE_PASSES = 4;

  /** A good loadout, fast, to hand the exhaustive search as its opening
   * incumbent. Greedy can't get the answer right (see searchBestLoadout) but it
   * gets close in microseconds, and branch and bound is only as good as the
   * incumbent it starts from — a strong one prunes most of the tree before the
   * search has done any real work.
   *
   * pickBestPerSlotWithSetBonuses ranks items against a single frozen set of
   * breakpoint slopes, read from where the hero is standing BEFORE the run. If
   * the pick then piles on flat Attack, the hero ends up further along the curve
   * than the slopes assumed. So: pick, move the slopes to where that pick would
   * actually put the hero, pick again, keeping whichever pass scores best on the
   * exact objective. Settles in two or three passes; the loop also stops if it
   * starts going round in a circle.
   *
   * Mutating state.breakpointScale is how the slopes reach weightedScore, which
   * every greedy ranking path funnels through. Restored by the caller. */
  function greedySeedLoadout(itemsBySlot, weights, excludeIds, currentLoadout, lockedSlots) {
    state.breakpointScale = computeBreakpointScale(currentLoadout || {});
    let best = null;
    let bestValue = -Infinity;
    const seen = new Set();
    for (let pass = 0; pass < OPTIMIZE_RESCALE_PASSES; pass++) {
      const loadout = pickBestPerSlotWithSetBonuses(
        itemsBySlot, weights, excludeIds, currentLoadout, lockedSlots
      );
      const value = totalScoreForLoadout(itemsBySlot, loadout, weights);
      if (value > bestValue) {
        bestValue = value;
        best = loadout;
      }
      const key = loadoutKey(loadout);
      if (seen.has(key)) break; // settled, or gone round in a circle
      seen.add(key);
      state.breakpointScale = computeBreakpointScale(loadout);
    }
    return best;
  }

  /** Auto-optimize: seed with greedy, then prove or beat it by searching every
   * combination (searchBestLoadout). Returns the search's report alongside the
   * loadout so the caller can say whether the answer is provably the best one.
   *
   * The breakpoint slopes get moved about during the greedy phase and are put
   * back on the way out, so the ledger and the item list keep reading the slopes
   * for the loadout the hero is actually wearing. */
  function optimizeLoadout(itemsBySlot, weights, excludeIds, currentLoadout, lockedSlots) {
    const savedScale = state.breakpointScale;
    try {
      const seed = greedySeedLoadout(
        itemsBySlot, weights, excludeIds, currentLoadout, lockedSlots
      );
      state.breakpointScale = computeBreakpointScale(currentLoadout || {});
      return searchBestLoadout(
        itemsBySlot, weights, excludeIds, currentLoadout, lockedSlots, seed
      );
    } finally {
      state.breakpointScale = savedScale;
    }
  }

  function ownerLabel(ownerKey) {
    if (ownerKey === NO_HERO_OWNER) return "— no hero, just gear —";
    return heroName(ownerKey);
  }

  function renderCompareOwnerSelects() {
    for (const selectEl of [compareOwnerAEl, compareOwnerBEl]) {
      selectEl.innerHTML = "";
      const skipOpt = document.createElement("option");
      skipOpt.value = NO_HERO_OWNER;
      skipOpt.textContent = ownerLabel(NO_HERO_OWNER);
      selectEl.appendChild(skipOpt);
      for (const hero of state.heroes) {
        const opt = document.createElement("option");
        opt.value = hero.id;
        opt.textContent = hero.name;
        selectEl.appendChild(opt);
      }
    }
    compareOwnerAEl.value = state.activeOwner;
    const otherOwner = state.heroes.find((h) => h.id !== state.activeOwner);
    compareOwnerBEl.value = otherOwner ? otherOwner.id : NO_HERO_OWNER;
  }

  /** Bare value text for a stat (no label prefix) — for table cells where
   * the label is already the row header. "—" for zero/absent. */
  function fmtValue(key, value) {
    if (!value) return "—";
    if (PERCENT_STATS.has(key)) return `${value * 100 >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
    return `${value >= 0 ? "+" : ""}${Math.round(value).toLocaleString()}`;
  }

  function fmtDelta(key, delta) {
    if (delta === 0) return "—";
    return fmtValue(key, delta);
  }

  function renderLoadoutDiff(labelA, combinedA, labelB, combinedB) {
    compareBodyEl.innerHTML = "";

    const swipeHint = document.createElement("p");
    swipeHint.className = "compare-swipe-hint";
    swipeHint.textContent = "Swipe to see the rest →";
    compareBodyEl.appendChild(swipeHint);

    const table = document.createElement("table");
    table.className = "compare-table";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const text of ["Stat", labelA, labelB, "Difference (B − A)"]) {
      const th = document.createElement("th");
      th.textContent = text;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    let anyRow = false;
    for (const key of Object.keys(STAT_LABELS)) {
      const a = combinedA[key] || 0;
      const b = combinedB[key] || 0;
      if (!a && !b) continue;
      anyRow = true;
      const delta = b - a;
      const deltaClass = delta > 0 ? "compare-delta-pos" : delta < 0 ? "compare-delta-neg" : "compare-delta-zero";
      const tr = document.createElement("tr");
      const statTd = document.createElement("td");
      statTd.textContent = STAT_LABELS[key];
      const aTd = document.createElement("td");
      aTd.className = "compare-value";
      aTd.textContent = fmtValue(key, a);
      const bTd = document.createElement("td");
      bTd.className = "compare-value";
      bTd.textContent = fmtValue(key, b);
      const deltaTd = document.createElement("td");
      deltaTd.className = `compare-value ${deltaClass}`;
      deltaTd.textContent = fmtDelta(key, delta);
      tr.append(statTd, aTd, bTd, deltaTd);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    if (!anyRow) {
      const empty = document.createElement("p");
      empty.className = "compare-empty";
      empty.textContent = "Neither side has any stats to compare yet.";
      compareBodyEl.appendChild(empty);
      return;
    }
    compareBodyEl.appendChild(table);
  }

  function refreshLoadoutCompare() {
    const ownerA = compareOwnerAEl.value;
    const ownerB = compareOwnerBEl.value;
    ensureOwnerLoadout(ownerA);
    ensureOwnerLoadout(ownerB);
    const combinedA = combinedStatsForLoadout(state.loadoutsByOwner[ownerA]);
    const combinedB = combinedStatsForLoadout(state.loadoutsByOwner[ownerB]);
    renderLoadoutDiff(ownerLabel(ownerA), combinedA, ownerLabel(ownerB), combinedB);
  }

  function openCompareModal() {
    compareControlsEl.hidden = false;
    renderCompareOwnerSelects();
    refreshLoadoutCompare();
    compareOverlayEl.hidden = false;
  }

  function closeCompareModal() {
    compareOverlayEl.hidden = true;
  }

  function openPasteCsvModal() {
    pasteCsvTextareaEl.value = "";
    pasteCsvOverlayEl.hidden = false;
    pasteCsvTextareaEl.focus();
  }

  function closePasteCsvModal() {
    pasteCsvOverlayEl.hidden = true;
  }

  function handlePasteCsvSubmit() {
    const text = pasteCsvTextareaEl.value.trim();
    if (!text) {
      showToast("Paste some CSV content first.");
      return;
    }
    if (applyCsvText(text)) closePasteCsvModal();
  }

  /** Item-vs-item compare inside a slot's picker: up to 2 checkboxes can be
   * checked at once (oldest is dropped when a 3rd is checked). */
  function handlePickerCompareToggle(itemId, checked) {
    const sel = state.pickerCompareSelection;
    const idx = sel.indexOf(itemId);
    if (checked) {
      if (idx === -1) {
        sel.push(itemId);
        if (sel.length > 2) sel.shift();
      }
    } else if (idx !== -1) {
      sel.splice(idx, 1);
    }
    updatePickerCompareBar();
  }

  function updatePickerCompareBar() {
    const count = state.pickerCompareSelection.length;
    pickerCompareStatusEl.textContent =
      count === 0 ? "Check up to 2 items to compare them." : `${count} of 2 selected.`;
    pickerCompareBtnEl.disabled = count !== 2;
  }

  /** The level a compared item is being SHOWN at, which is its cap rather than
   * its current level while max-level scoring is on. */
  function compareLevelLabel(item) {
    if (state.maxLevelScoring && item.projectedMaxStats) return `Lvl ${item.projectedMaxLevel} max`;
    return `Lvl ${item.level}`;
  }

  function openItemCompareModal(slot, itemIdA, itemIdB) {
    const itemA = itemById(slot, itemIdA);
    const itemB = itemById(slot, itemIdB);
    compareControlsEl.hidden = true;
    renderLoadoutDiff(
      `${itemA.name} (${compareLevelLabel(itemA)})`, scoreStats(itemA),
      `${itemB.name} (${compareLevelLabel(itemB)})`, scoreStats(itemB)
    );
    compareOverlayEl.hidden = false;
  }

  function renderHeroSelect() {
    heroSelectEl.innerHTML = "";
    const skipOpt = document.createElement("option");
    skipOpt.value = "";
    skipOpt.textContent = "— no hero, just gear —";
    heroSelectEl.appendChild(skipOpt);
    for (const hero of state.heroes) {
      const opt = document.createElement("option");
      opt.value = hero.id;
      opt.textContent = hero.name;
      heroSelectEl.appendChild(opt);
    }
    // Rebuilding the options drops the selection back to the first one, which
    // would show "no hero" over a state that says otherwise. Reflect the
    // active owner, the way renderOptimizeContextSelect reflects the scenario.
    heroSelectEl.value = state.activeOwner;
    if (heroSelectEl.selectedIndex < 0) heroSelectEl.value = NO_HERO_OWNER;
  }

  /** Number of stats with a nonzero weight — shown as a badge on the
   * Auto-optimize button, same pattern as the Filter menu's count badge. */
  function optimizeWeightCount() {
    return Object.values(state.optimizeWeights).filter((w) => w).length;
  }

  function updateOptimizeWeightBadge() {
    const count = optimizeWeightCount();
    optimizeWeightBadgeEl.hidden = count === 0;
    optimizeWeightBadgeEl.textContent = count;
    // The upgrade plan is scored with these weights, so it goes stale the
    // moment they change. Every weight mutation ends up here — the number
    // boxes, the "only this stat" buttons, the troop presets and Clear — which
    // makes this the one chokepoint that keeps the plan honest, the same way
    // refreshTotals() is for the ledger.
    renderUpgradePlan();
    renderPvpBuyPlan();
  }

  /** Populate the scenario <select> from the known set contexts and reflect
   * the current state. Options are static, so this only needs to run once. */
  function renderOptimizeContextSelect() {
    optimizeContextSelectEl.innerHTML = "";
    for (const { value, label } of optimizeContextOptions()) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      optimizeContextSelectEl.appendChild(opt);
    }
    optimizeContextSelectEl.value = state.optimizeContext;
    // A restored scenario names a set context that this build of the app may
    // no longer define, which would leave the <select> showing nothing over a
    // state that says otherwise. "General" is always on offer.
    if (optimizeContextSelectEl.selectedIndex < 0) setOptimizeContext("general");
  }

  function renderOptimizeWeightList() {
    optimizeWeightListEl.innerHTML = "";
    for (const key of state.availableStats) {
      const row = document.createElement("label");
      row.className = "filter-checkbox-item optimize-weight-row";

      const nameSpan = document.createElement("span");
      nameSpan.className = "optimize-weight-name";
      nameSpan.textContent = STAT_LABELS[key] || key;
      row.appendChild(nameSpan);

      const onlyBtn = document.createElement("button");
      onlyBtn.type = "button";
      onlyBtn.className = "optimize-weight-only-btn";
      onlyBtn.textContent = "Only";
      onlyBtn.title = `Weight only ${STAT_LABELS[key] || key} — clears every other stat's weight.`;
      onlyBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        state.optimizeWeights = { [key]: 1 };
        optimizeTroopSelectEl.value = "custom";
        saveOptimizeSetup();
        renderOptimizeWeightList();
        updateOptimizeWeightBadge();
      });
      row.appendChild(onlyBtn);

      const input = document.createElement("input");
      input.type = "number";
      input.min = "0";
      input.step = "1";
      input.className = "optimize-weight-input";
      input.value = state.optimizeWeights[key] || "";
      input.placeholder = "0";
      input.addEventListener("click", (e) => e.stopPropagation());
      input.addEventListener("input", () => {
        const value = parseFloat(input.value);
        if (value > 0) state.optimizeWeights[key] = value;
        else delete state.optimizeWeights[key];
        // A hand-edited weight no longer matches any preset.
        optimizeTroopSelectEl.value = "custom";
        saveOptimizeSetup();
        updateOptimizeWeightBadge();
      });

      row.appendChild(input);
      optimizeWeightListEl.appendChild(row);
    }
  }

  /** Replace the current optimize weights with a preset. Only stats present in
   * the current inventory (state.availableStats) are applied, so the visible
   * inputs and the badge count stay in sync with the weights actually driving
   * the optimize. "custom" clears nothing — it just leaves whatever weights are
   * already set. */
  function applyTroopPreset(presetKey) {
    const presetWeights = troopPresetWeights(presetKey);
    if (!presetWeights) return; // "custom" or unknown — keep existing weights as-is
    const available = new Set(state.availableStats);
    const weights = {};
    for (const [key, value] of Object.entries(presetWeights)) {
      if (available.has(key)) weights[key] = value;
    }
    state.optimizeWeights = weights;
    // A preset none of whose stats the inventory has applies nothing, and does
    // it silently: the dropdown names the preset, the weight list stays empty,
    // and Optimize answers with "give at least one stat a weight first" as if
    // the player had never picked one. Reachable with a saved default whose
    // stats a newly loaded inventory doesn't carry. Say what happened.
    if (!Object.keys(weights).length && Object.keys(presetWeights).length) {
      const label = (TROOP_PRIORITY_PRESETS[presetKey] || {}).label || presetKey;
      showToast(`No stat in this inventory is one the ${label} preset weights `
        + `— weights left empty. Load the data those stats come from, or set weights by hand.`);
    }
    applyPresetScenario(presetKey);
    saveOptimizeSetup();
    renderOptimizeWeightList();
    updateOptimizeWeightBadge();
  }

  /** Re-run whichever preset the troop dropdown is pointing at, for when the
   * thing a preset is filtered against — the inventory's stat set — changes
   * under it. Returns whether a preset was applied; "Custom" means the weights
   * standing are hand-set and there's nothing to re-derive.
   *
   * The scenario is deliberately not re-asserted over a manual choice: a
   * re-apply is the inventory changing, not the player picking the preset
   * again, so a scenario that's theirs (presetAppliedScenario null — see there)
   * is put back afterwards. */
  function reapplyActiveTroopPreset() {
    if (!optimizeTroopSelectEl) return false;
    const presetKey = optimizeTroopSelectEl.value;
    if (!presetKey || presetKey === "custom") return false;
    const playerOwnsScenario = presetAppliedScenario === null;
    const scenarioBefore = state.optimizeContext;
    applyTroopPreset(presetKey);
    if (playerOwnsScenario && state.optimizeContext !== scenarioBefore) {
      setOptimizeContext(scenarioBefore);
      forgetPresetScenario();
      // applyTroopPreset wrote the preset's scenario down a moment ago; the
      // player's is the one that stands, so it has to be the one saved.
      saveOptimizeSetup();
    }
    return true;
  }

  /** Presets that imply the scenario their gear is used in, so picking one
   * doesn't quietly score that gear's set bonuses at zero. Gathering is the
   * clear case: the Prospector's Kit only pays while gathering, and leaving the
   * scenario on "General" would have the Gathering preset ignore the one set
   * that exists for the job it's for.
   *
   * The troop presets are deliberately absent. They serve PvP and field battles
   * both, and picking a scenario for the player would silently discard set
   * bonuses for whichever half they meant. */
  const PRESET_SCENARIO = { gathering: "gathering" };

  /** What applyPresetScenario last set the scenario to, and what was showing
   * before it did — both null whenever no preset's scenario is in force.
   *
   * The override has to be undone as well as applied, and neither half can be
   * done unconditionally. Gathering sets the scenario on the way IN; with no
   * way to undo it, picking Infantry afterwards left the scenario on Gathering
   * and quietly scored a PvP build with the Prospector's Kit bonus counted.
   * Reverting on every scenario-less preset is the opposite bug — it discards a
   * scenario the player chose by hand. So the revert is gated on the value
   * still being the one the preset put there, and a manual change to the
   * dropdown clears the pair outright, because at that point the choice is the
   * player's again and no later preset should take it back. */
  let presetAppliedScenario = null;
  let scenarioBeforePreset = null;

  /** Flip the scoring basis between "gear as it is" and "gear at its cap".
   *
   * Everything downstream of scoreStats moves at once, which is why this
   * repaints rather than just setting a flag: the stat-scale divisors are read
   * off the same numbers (so a weight of 1 goes on meaning the same thing), the
   * slot cards and picker restate their stats on the new basis, and the ledger
   * and both plan panels re-derive from it. Nothing about the loadout itself
   * changes — the toggle picks the question, the Optimize button answers it. */
  function setMaxLevelScoring(on) {
    state.maxLevelScoring = Boolean(on);
    if (optimizeMaxLevelEl) optimizeMaxLevelEl.checked = state.maxLevelScoring;
    refreshStatScale();
    saveOptimizeSetup();
    renderSlots();
    refreshTotals();
  }

  function setOptimizeContext(value) {
    state.optimizeContext = value;
    if (optimizeContextSelectEl) optimizeContextSelectEl.value = value;
  }

  function scenarioIsOffered(value) {
    return Boolean(optimizeContextSelectEl)
      && Array.from(optimizeContextSelectEl.options).some((o) => o.value === value);
  }

  /** Called by applyPresetScenario and by the scenario dropdown's own change
   * handler, so a preset's override can never outlive the preset that set it. */
  function forgetPresetScenario() {
    presetAppliedScenario = null;
    scenarioBeforePreset = null;
  }

  /** Point the scenario dropdown at the preset's own scenario, if it has one
   * and that scenario is actually offered (the list is built from the sets a
   * player's data knows about — see optimizeContextOptions); and put the
   * scenario back when a preset that has none follows one that did. */
  function applyPresetScenario(presetKey) {
    if (!optimizeContextSelectEl) return;
    const scenario = PRESET_SCENARIO[presetKey];

    if (!scenario) {
      // Still standing means the player hasn't touched it since — so it's the
      // preset's to undo. Anything else is theirs and is left alone.
      if (presetAppliedScenario && state.optimizeContext === presetAppliedScenario) {
        // The scenario list is rebuilt per inventory, so what was showing
        // before may no longer be on offer; "general" always is.
        setOptimizeContext(scenarioIsOffered(scenarioBeforePreset) ? scenarioBeforePreset : "general");
      }
      forgetPresetScenario();
      return;
    }

    if (!scenarioIsOffered(scenario)) return;
    // Recorded only on the way in from a non-preset scenario, so picking
    // Gathering twice doesn't record Gathering as the thing to go back to.
    if (!presetAppliedScenario) scenarioBeforePreset = state.optimizeContext;
    presetAppliedScenario = scenario;
    setOptimizeContext(scenario);
  }

  /** Save the current weights as the player's own default for a troop type,
   * then point the troop dropdown at it so the "(custom)" label and Reset
   * button reflect the change immediately. */
  function saveTroopPreset(troopKey) {
    if (!(troopKey in TROOP_PRIORITY_PRESETS)) return;
    const weights = {};
    for (const [key, value] of Object.entries(state.optimizeWeights)) {
      if (value > 0) weights[key] = value;
    }
    if (!Object.keys(weights).length) {
      showToast("Set at least one weight before saving a troop default.");
      return;
    }
    state.customTroopPresets[troopKey] = weights;
    saveTroopPresets();
    optimizeTroopSelectEl.value = troopKey;
    // The weights didn't move, but the dropdown now names this preset instead
    // of Custom, and that label is half of what a reload restores.
    saveOptimizeSetup();
    updateTroopPresetControls();
    showToast(`Saved these weights as your ${TROOP_PRIORITY_PRESETS[troopKey].label} default.`);
  }

  /** Discard the player's saved default for a troop type, reverting the
   * dropdown to the built-in preset. */
  function resetTroopPreset(troopKey) {
    if (!state.customTroopPresets[troopKey]) return;
    delete state.customTroopPresets[troopKey];
    saveTroopPresets();
    updateTroopPresetControls();
    // If the dropdown is currently on this troop, re-fill from the built-in.
    if (optimizeTroopSelectEl.value === troopKey) applyTroopPreset(troopKey);
    showToast(`Reset ${TROOP_PRIORITY_PRESETS[troopKey].label} to the built-in default.`);
  }

  /** Keep the troop-priority UI in sync with which troops have a saved custom
   * default: mark those options "(custom)" and show the Reset button only when
   * the troop selected in the save dropdown actually has one. */
  function updateTroopPresetControls() {
    for (const opt of optimizeTroopSelectEl.options) {
      if (!(opt.value in TROOP_PRIORITY_PRESETS)) continue;
      const label = TROOP_PRIORITY_PRESETS[opt.value].label;
      opt.textContent = state.customTroopPresets[opt.value] ? `${label} (custom)` : label;
    }
    const saveTarget = optimizeTroopSaveSelectEl.value;
    optimizeTroopResetBtnEl.hidden = !state.customTroopPresets[saveTarget];
  }

  function renderSlots() {
    slotsEl.innerHTML = "";
    const loadout = activeLoadout();
    const lockedSlots = lockedSlotsForOwner(state.activeOwner);
    for (const slot of state.slotOrder) {
      const itemId = loadout[slot];
      const it = itemId ? itemById(slot, itemId) : null;
      const isLocked = lockedSlots.has(slot);

      const card = document.createElement("div");
      card.className = "slot-card" + (it ? " filled rarity-" + it.rarity : "") + (isLocked ? " slot-locked" : "");
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");
      card.setAttribute("aria-label", `${slot} slot — ${it ? it.name : "empty, click to choose"}`);
      card.addEventListener("click", () => openPicker(slot));
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPicker(slot); }
      });

      const head = document.createElement("div");
      head.className = "slot-card-head";
      const label = document.createElement("div");
      label.className = "slot-label";
      label.textContent = slot;
      head.appendChild(label);

      const matchCount = slotMatchCount(slot);
      if (matchCount !== null) {
        const badge = document.createElement("span");
        badge.className = "slot-match-badge";
        badge.textContent = `${matchCount} match${matchCount === 1 ? "" : "es"}`;
        head.appendChild(badge);
      }

      const lockBtn = document.createElement("button");
      lockBtn.type = "button";
      lockBtn.className = "slot-lock-btn" + (isLocked ? " active" : "");
      lockBtn.title = isLocked
        ? "Locked — auto-optimize won't touch this slot. Click to unlock."
        : "Lock this slot so auto-optimize leaves it alone.";
      lockBtn.setAttribute("aria-label", lockBtn.title);
      lockBtn.textContent = isLocked ? "🔒" : "🔓";
      lockBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleSlotLock(slot);
      });
      head.appendChild(lockBtn);
      card.appendChild(head);

      if (it) {
        const name = document.createElement("div");
        name.className = "slot-item-name";
        name.textContent = it.name;
        card.appendChild(name);

        const meta = document.createElement("div");
        meta.className = "slot-meta";
        meta.innerHTML = itemMetaHtml(it);
        card.appendChild(meta);

        const statLines = displayStatLines(it);
        if (statLines.length) {
          const stats = document.createElement("div");
          stats.className = "slot-stats";
          stats.textContent = statLines.join(" · ");
          card.appendChild(stats);
        }
      } else {
        const empty = document.createElement("div");
        empty.className = "slot-empty-name";
        empty.textContent = "Empty — click to choose";
        card.appendChild(empty);
      }

      slotsEl.appendChild(card);
    }

    updateLiveEquipButtonVisibility();
  }

  function openPicker(slot) {
    pickerTitleEl.textContent = slot.charAt(0) + slot.slice(1).toLowerCase();
    state.pickerCompareSelection = [];
    state.pickerSearchQuery = "";
    state.pickerStatFilters.clear();
    pickerSearchInputEl.value = "";
    pickerCompareBarEl.dataset.slot = slot;
    renderPickerFilterMenu();
    updatePickerFilterCountBadge();
    renderPickerList(slot);
    overlayEl.hidden = false;
  }

  function renderPickerFilterMenu() {
    pickerFilterCheckboxListEl.innerHTML = "";
    for (const key of state.availableStats) {
      const label = document.createElement("label");
      label.className = "filter-checkbox-item";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = key;
      checkbox.checked = state.pickerStatFilters.has(key);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) state.pickerStatFilters.add(key);
        else state.pickerStatFilters.delete(key);
        updatePickerFilterCountBadge();
        renderPickerList(pickerCompareBarEl.dataset.slot);
      });

      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(STAT_LABELS[key] || key));
      pickerFilterCheckboxListEl.appendChild(label);
    }
  }

  function updatePickerFilterCountBadge() {
    const count = state.pickerStatFilters.size;
    pickerFilterCountBadgeEl.hidden = count === 0;
    pickerFilterCountBadgeEl.textContent = count;
  }

  function renderPickerList(slot) {
    pickerListEl.innerHTML = "";

    const loadout = activeLoadout();
    const lockedMap = computeLockedMap();

    const emptyBtn = document.createElement("button");
    emptyBtn.type = "button";
    emptyBtn.className = "picker-option";
    if (!loadout[slot]) emptyBtn.classList.add("selected");
    emptyBtn.innerHTML = `<span class="picker-option-empty">Leave empty</span>`;
    emptyBtn.addEventListener("click", () => choose(slot, null));
    pickerListEl.appendChild(emptyBtn);

    const items = state.itemsBySlot[slot] || [];
    if (!items.length) {
      const none = document.createElement("p");
      none.className = "ledger-empty";
      none.style.padding = "0.6rem";
      none.textContent = "You don't own any items for this slot.";
      pickerListEl.appendChild(none);
      pickerCompareBarEl.hidden = true;
    } else {
      pickerCompareBarEl.hidden = false;
      updatePickerCompareBar();
    }

    let visibleCount = 0;
    for (const it of items) {
      const lockedByOwner = lockedMap.get(it.id);
      // An item locked to the CURRENTLY ACTIVE owner (or to another
      // pseudo-owner of the SAME hero, e.g. their march vs instanced set)
      // is just "selected", not locked — locking only applies to actually
      // different heroes' loadouts.
      const isLockedElsewhere = lockedByOwner
        && heroGroupKey(lockedByOwner) !== heroGroupKey(state.activeOwner);
      // The filter hides non-matching items EXCEPT the one currently
      // selected in this slot — you should always be able to see and
      // compare against what you already have equipped. The picker's OWN
      // search box narrows further and has no such exception — it's a
      // pure "find it in this list" tool, not a loadout filter.
      const isSelected = loadout[slot] === it.id;
      const matchesPickerSearch = !state.pickerSearchQuery
        || it.name.toLowerCase().includes(state.pickerSearchQuery);
      const matchesPickerStatFilter = itemMatchesPickerStatFilter(it);
      const isFilteredOut = (!isSelected && (!itemMatchesActiveFilters(it) || !matchesPickerStatFilter))
        || !matchesPickerSearch;
      if (!isFilteredOut) visibleCount++;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "picker-option rarity-" + it.rarity;
      if (isSelected) btn.classList.add("selected");
      if (isFilteredOut) btn.classList.add("filtered-out");
      if (isLockedElsewhere) {
        btn.classList.add("locked");
        btn.disabled = true;
      }

      const compareCheckbox = document.createElement("input");
      compareCheckbox.type = "checkbox";
      compareCheckbox.className = "picker-option-compare-checkbox";
      compareCheckbox.title = "Select to compare with another item";
      compareCheckbox.checked = state.pickerCompareSelection.includes(it.id);
      compareCheckbox.addEventListener("click", (e) => e.stopPropagation());
      compareCheckbox.addEventListener("change", () => {
        handlePickerCompareToggle(it.id, compareCheckbox.checked);
      });
      btn.appendChild(compareCheckbox);

      const equippedHeroNames = (it.equippedByOwnerIds || [])
        .map((ownerId) => state.heroes.find((h) => h.id === ownerId))
        .filter(Boolean)
        .map((h) => h.name);

      const nameLine = document.createElement("div");
      nameLine.className = "picker-option-name";
      nameLine.textContent = it.name;
      btn.appendChild(nameLine);

      const metaLine = document.createElement("div");
      metaLine.className = "picker-option-meta";
      metaLine.innerHTML = itemMetaHtml(it);
      if (isLockedElsewhere) {
        const tag = document.createElement("span");
        tag.className = "locked-tag";
        tag.textContent = `used by ${heroName(lockedByOwner)}`;
        metaLine.appendChild(tag);
      } else if (equippedHeroNames.length) {
        const tag = document.createElement("span");
        tag.className = "equipped-tag";
        tag.title = "This reflects your real game data at export time — the loadout builder can't change it.";
        tag.textContent = `in-game: equipped on ${equippedHeroNames.join(", ")}`;
        metaLine.appendChild(tag);
      }
      btn.appendChild(metaLine);

      const statLines = displayStatLines(it);
      if (statLines.length) {
        const statsLine = document.createElement("div");
        statsLine.className = "picker-option-stats";
        statsLine.textContent = statLines.join(" · ");
        btn.appendChild(statsLine);
      }

      if (!isLockedElsewhere) {
        btn.addEventListener("click", () => choose(slot, it.id));
      }
      pickerListEl.appendChild(btn);
    }

    if (items.length && visibleCount === 0) {
      const none = document.createElement("p");
      none.className = "ledger-empty";
      none.style.padding = "0.6rem";
      none.textContent = "No items match the active filter for this slot.";
      pickerListEl.appendChild(none);
    }
  }

  function closePicker() {
    overlayEl.hidden = true;
    state.pickerCompareSelection = [];
    state.pickerSearchQuery = "";
    state.pickerStatFilters.clear();
    closePickerFilterMenu();
  }

  function choose(slot, itemId) {
    activeLoadout()[slot] = itemId;
    saveLoadouts();
    closePicker();
    invalidatePendingLiveEquip();
    renderSlots();
    refreshTotals();
  }

  /** The troop buff the active hero's raw Attack/Defence/Health actually grant,
   * for the loadout currently on screen — the payoff of the whole breakpoint
   * model, shown rather than left implicit in the optimizer's scoring.
   *
   * Hidden entirely when there's no hero to speak of (the no-hero scratch
   * space, or imported data with no rarity/totals), because a buff percentage
   * is meaningless without a hero to attach it to.
   *
   * Built from the ledger's own row classes so it reads as a continuation of
   * Totals. The line carries just the percentage; the raw stat feeding the
   * curve and the cap threshold sit in the row's tooltip, with a capped stat
   * flagged inline since that's the one thing worth acting on. */
  /** Where the next chunk of XP goes, for the loadout currently on screen.
   *
   * One pot, split across the pieces. "I have 20,000 XP" has an answer that
   * carves that pot up, and it can't be assembled out of per-piece costings:
   * two pieces feeding the same hero stat compete, so the second one in is
   * worth less than it looks measured on its own. allocateUpgradeXp does the
   * carving, one level at a time, against a shared running total.
   *
   * Value per XP is the rule at every step. Ordering by raw power gained would
   * just list the legendaries — they gain the most because they start highest,
   * and they also cost 8x a common for the same level.
   *
   * A piece's cheapest remaining levels are always its next ones: cost
   * compounds at 8% a level while the stats a level adds stay flat
   * (LEVEL_STAT_STEP of the item's LEVEL-1 stats, not a percentage of its
   * current). That's why an under-levelled piece keeps winning steps until it
   * has caught up, and why the split lands where it does. */
  function scoreItemStats(stats, weights) {
    return optimisticItemValue({ rawStats: stats }, weights);
  }

  /** What a whole loadout's combined stats are worth, on the same basis as
   * optimisticItemValue scores a single item. */
  function scoreLoadoutStats(stats, weights) {
    const exact = exactBreakpointScore(stats, weights);
    if (exact === null) return weightedScore(stats, weights);
    return exact + weightedScore(stats, weights, BREAKPOINT_STAT_KEYS);
  }

  /** Every equipped piece that can still be levelled, with the price of each
   * remaining level and the flat stats one level adds.
   *
   * That per-level stat delta is a genuine constant: a level adds
   * LEVEL_STAT_STEP of the item's LEVEL-1 stats, not a percentage of its
   * current, so the same vector applies at every level of the climb. What is
   * emphatically NOT constant is what that vector is worth to the hero. */
  function upgradeCandidates(loadout) {
    const candidates = [];
    for (const slot of SLOT_ORDER) {
      const item = loadout && loadout[slot] ? itemById(slot, loadout[slot]) : null;
      if (!item) continue;
      const levelsToGo = item.projectedLevelsToGo || 0;
      if (!levelsToGo) continue;
      const costs = [];
      for (let lv = item.level; lv < item.projectedMaxLevel; lv++) {
        costs.push(xpForNextLevel(item.rarity, lv));
      }
      if (!costs.length || costs.some((c) => !c)) continue;
      const oneLevel = projectStatsToLevel(item.rawStats, item.level, item.level + 1);
      const perLevelDelta = {};
      for (const key of BREAKPOINT_STAT_ORDER) {
        const delta = (oneLevel[key] || 0) - (item.rawStats[key] || 0);
        if (delta) perLevelDelta[key] = delta;
      }
      candidates.push({ item, slot, costs, perLevelDelta });
    }
    return candidates;
  }

  /** What the hero's Army command buffs would actually move by, going from one
   * set of gear stats to another. Real percentage points off the breakpoint
   * curve, not weighted score — this is what gets shown, because "+0.8% Army
   * Attack" means something and a weighted score doesn't.
   *
   * Null when there's no hero to run a curve for; the caller falls back to
   * reporting the flat stat change instead. */
  const MIN_SHOWN_COMMAND_MOVE = 0.00005;

  function armyCommandDeltas(fromStats, toStats, minMove = MIN_SHOWN_COMMAND_MOVE) {
    const hero = activeHero();
    if (!hero || !hero.statTotals) return null;
    const rarity = hero.rarity || DEFAULT_HERO_RARITY;
    const before = heroStatTotalsFor(hero, fromStats);
    const after = heroStatTotalsFor(hero, toStats);
    const deltas = {};
    for (const [statKey, { kind }] of Object.entries(BREAKPOINT_STATS)) {
      const delta = heroStatPercent(rarity, kind, after[statKey])
        - heroStatPercent(rarity, kind, before[statKey]);
      if (Math.abs(delta) > minMove) deltas[statKey] = delta;
    }
    return deltas;
  }

  /** Positive movement only — for the upgrade plan, where buying levels can
   * only ever add stats and a negative would mean a bug rather than a
   * trade-off. Anything that can LOSE a stat wants armyCommandDeltas instead:
   * filtering a swap's losses away here reports a straight gain for a trade.
   *
   * Pass minMove: 0 to keep movements too small to print. Nothing displays a
   * figure that way, but a caller summing many small steps has to, or the sum
   * comes out short of the whole it's meant to add up to. */
  function armyCommandGains(fromStats, toStats, minMove) {
    const deltas = armyCommandDeltas(fromStats, toStats, minMove);
    if (!deltas) return null;
    const gains = {};
    for (const [statKey, delta] of Object.entries(deltas)) {
      if (delta > 0) gains[statKey] = delta;
    }
    return gains;
  }

  /** Split a pot of XP across the equipped pieces, best value per XP first.
   *
   * Greedy, one level at a time: each step buys the single best-value level
   * available anywhere in the loadout, then re-scores the whole loadout before
   * choosing the next. Greedy isn't a shortcut here, it's the answer — every
   * piece's value curve is concave (a level adds a fixed stat step while its
   * cost compounds at 8%, and the hero's breakpoint curve flattens on top of
   * that), and on concave curves taking the best marginal step every time is
   * the best split of the pot.
   *
   * Re-scoring against the SHARED running total is the whole point of doing it
   * this way rather than costing each piece against today's loadout: once one
   * piece has pushed a stat towards the hero's ceiling, the next level of
   * another piece moving the same stat is worth less, and the pot moves on by
   * itself. Six independent costings can't see that, and will happily spend
   * everything twice over on the same stat.
   *
   * A piece that gains nothing drops out for good, which is safe rather than
   * greedy-blind: gaining nothing means the hero is already past the ceiling on
   * everything that piece moves, and every level bought afterwards can only
   * push those same stats further past it. */
  function allocateUpgradeXp(candidates, baseStats, weights, budget) {
    const running = { ...baseStats };
    let score = scoreLoadoutStats(running, weights);
    let spent = 0;

    const tracks = candidates.map((cand) => ({
      cand, levels: 0, xp: 0, benefit: 0, armyGains: null, dead: false,
    }));

    const shiftStats = (cand, sign) => {
      for (const [key, delta] of Object.entries(cand.perLevelDelta)) {
        running[key] = (running[key] || 0) + sign * delta;
      }
    };

    /** What one more level of this piece would be worth from where the split
     * currently stands, leaving `running` exactly as it found it. */
    const marginalGain = (cand) => {
      shiftStats(cand, 1);
      const trial = scoreLoadoutStats(running, weights);
      shiftStats(cand, -1);
      return trial - score;
    };

    // Which pieces are worth anything AT ALL, measured before a single XP is
    // committed. A piece that ends up with nothing because the pot did more
    // elsewhere is a different answer from one that is capped, and only a
    // reading taken while the pot is still whole can tell the two apart.
    for (const track of tracks) {
      if (marginalGain(track.cand) <= 0) track.dead = true;
    }

    for (;;) {
      let best = null;
      for (const track of tracks) {
        if (track.dead || track.levels >= track.cand.costs.length) continue;
        const gain = marginalGain(track.cand);
        if (gain <= 0) { track.dead = true; continue; }
        const cost = track.cand.costs[track.levels];
        // Costs only climb and the pot only shrinks, so a level out of reach
        // now stays out of reach — but the piece isn't finished, it's starved,
        // and it keeps its remaining levels for the panel to report.
        if (spent + cost > budget) continue;
        // gain/cost against best.gain/best.cost, cross-multiplied: both costs
        // are positive, and this keeps the comparison off floating-point
        // division for ratios that are often within a hair of each other.
        if (!best || gain * best.cost > best.gain * cost) best = { track, cost, gain };
      }
      if (!best) break;

      const before = { ...running };
      shiftStats(best.track.cand, 1);
      score += best.gain;
      spent += best.cost;
      best.track.levels += 1;
      best.track.xp += best.cost;
      best.track.benefit += best.gain;

      // Accumulated a purchase at a time rather than measured from the
      // baseline at the end. The buff curve is non-linear, so a piece's honest
      // share is what it added at the point it was actually bought — and
      // shares totted up that way add back to the plan's own total, which
      // measured-alone figures wouldn't. Hence minMove 0 too: one level often
      // moves the buff by less than the display threshold, and dropping those
      // steps would leave the rows adding up to visibly less than the total.
      const step = armyCommandGains(before, running, 0);
      if (step) {
        const into = best.track.armyGains || (best.track.armyGains = {});
        for (const [key, delta] of Object.entries(step)) {
          into[key] = (into[key] || 0) + delta;
        }
      }
    }

    return {
      tracks,
      spent,
      armyGains: armyCommandGains(baseStats, running),
      // The cheapest level the split didn't buy: what says whether the leftover
      // is small change or a level short.
      cheapestUnbought: tracks.reduce((cheapest, track) => {
        if (track.dead || track.levels >= track.cand.costs.length) return cheapest;
        return Math.min(cheapest, track.cand.costs[track.levels]);
      }, Infinity),
    };
  }

  /** The accumulated movement a row is worth printing: the pieces buying a
   * level or two of something the hero barely notices would otherwise each
   * advertise a "+0.00%". Their XP still shows, which is the honest answer —
   * they got a slice, it bought nothing you can see. */
  function showableCommandGains(gains) {
    if (!gains) return null;
    const shown = {};
    for (const [key, delta] of Object.entries(gains)) {
      if (delta > MIN_SHOWN_COMMAND_MOVE) shown[key] = delta;
    }
    return shown;
  }

  /** One piece's slice of the pot, and what that slice buys it. */
  function upgradePlanRow(track, spent) {
    const cand = track.cand;
    const targetLevel = cand.item.level + track.levels;
    const atTarget = projectStatsToLevel(cand.item.rawStats, cand.item.level, targetLevel);
    const statGains = {};
    for (const key of BREAKPOINT_STAT_ORDER) {
      const delta = (atTarget[key] || 0) - (cand.item.rawStats[key] || 0);
      if (Math.round(delta)) statGains[key] = delta;
    }
    return {
      item: cand.item,
      levels: track.levels,
      xp: track.xp,
      share: spent > 0 ? track.xp / spent : 0,
      targetLevel,
      benefit: track.benefit,
      statGains,
      armyGains: showableCommandGains(track.armyGains),
      levelsLeft: cand.costs.length - track.levels,
      // Stopped because the pot ran dry, not because the piece was finished:
      // still gaining, still has levels left. A bigger budget buys more here.
      wantsMore: !track.dead && track.levels < cand.costs.length,
    };
  }

  /** How the next `budget` XP splits across the equipped pieces, and what the
   * loadout gets for it.
   *
   * The rows are one carve-up of one pot: their XP adds up to what the plan
   * spends, and their Command gains add up to what it gains. Pieces that get
   * nothing come back separately and split by WHY — capped, unweighted, or
   * simply outbid by the others — because those want three different answers,
   * and a zero-scoring row in the list would give the same one to all three. */
  function buildUpgradePlan(loadout, weights, budget) {
    const candidates = upgradeCandidates(loadout);
    let equippedCount = 0;
    for (const slot of SLOT_ORDER) {
      if (loadout && loadout[slot] && itemById(slot, loadout[slot])) equippedCount++;
    }
    // The loadout as it stands today: the point on the hero's breakpoint curve
    // that the first bought level moves from, and what the split is measured
    // against. Deliberately currentStats and not scoreStats — this panel prices
    // the climb to the cap, so scoring its starting point AT the cap (which is
    // what max-level scoring would do) would have every row measure a level it
    // had already counted as bought, and report gains on top of gains.
    const baseStats = combinedStatsForLoadout(loadout, currentStats);
    const alloc = allocateUpgradeXp(candidates, baseStats, weights, budget);

    const rows = [];
    const capped = [];
    const unweighted = [];
    const outbid = [];
    let cheapestStep = Infinity;
    for (const track of alloc.tracks) {
      if (track.cand.costs[0] < cheapestStep) cheapestStep = track.cand.costs[0];
      if (track.levels > 0) { rows.push(upgradePlanRow(track, alloc.spent)); continue; }
      if (!track.dead) {
        // Worth something, got nothing: every XP in the pot did more elsewhere
        // (or the pot won't stretch to a single level anywhere).
        outbid.push(track.cand.item);
        continue;
      }
      // Two very different reasons a piece gains nothing, and telling the user
      // the wrong one is worse than saying nothing: either the hero is past the
      // ceiling on what it moves, or it moves nothing this build cares about.
      const movesSomethingWeighted = Object.keys(track.cand.perLevelDelta)
        .some((key) => weights[key]);
      (movesSomethingWeighted ? capped : unweighted).push(track.cand.item);
    }
    rows.sort((a, b) => b.benefit - a.benefit);

    return {
      rows, capped, unweighted, outbid, equippedCount, budget,
      spent: alloc.spent,
      leftover: Math.max(0, budget - alloc.spent),
      armyGains: alloc.armyGains,
      cheapestUnbought: Number.isFinite(alloc.cheapestUnbought) ? alloc.cheapestUnbought : 0,
      cheapestStep: Number.isFinite(cheapestStep) ? cheapestStep : 0,
      upgradeableCount: candidates.length,
    };
  }

  /** The how-good-is-this-row-against-the-best bar both plan panels end a row
   * with. The wrapper is what lets the track sit at the BOTTOM of its card: the
   * grid stretches every card in a line to the tallest one, so a bar that
   * floats directly under text ends up at a different height in each column and
   * stops being comparable at a glance — which is the one job it has. */
  function planValueBar(relative) {
    const slot = document.createElement("div");
    slot.className = "upgrade-plan-bar-slot";
    const bar = document.createElement("div");
    bar.className = "upgrade-plan-bar";
    const fill = document.createElement("span");
    fill.style.width = `${Math.max(2, relative)}%`;
    bar.appendChild(fill);
    slot.appendChild(bar);
    return slot;
  }

  /** The panel's heading is always on the page; only its body opens and closes.
   * Collapsed it also skips building the rows — the split costs a re-score of
   * the whole loadout per piece per level it buys, and nothing else on screen
   * reads it. */
  /** Demote a stat figure the ranking can't see. Both panels report every
   * command stat that MOVED, but only stats carrying a weight reach the score
   * behind the value bar — so a row can advertise "Defense +0.25%" and be
   * ranked as though it gained nothing, which reads as a broken bar rather than
   * as a weighting the reader chose. */
  function markIfUnweighted(part, key, weights) {
    if (weights && weights[key]) return;
    part.classList.add("is-unweighted");
    part.title = `${STAT_LABELS[key]} carries no weight in Auto-optimize, so this `
      + `gain doesn't count toward how this row is ranked.`;
  }

  function renderUpgradePlan() {
    if (!upgradePlanWrapEl || !upgradePlanEl) return;
    applyPanelOpenState(
      upgradePlanWrapEl, upgradePlanToggleEl, upgradePlanBodyEl, state.showUpgradePlan,
    );
    if (!state.showUpgradePlan) return;
    const weights = state.optimizeWeights;
    if (optimizeWeightCount() === 0) {
      upgradePlanSummaryEl.textContent =
        "Give at least one stat a weight in Auto-optimize to rank these by benefit.";
      upgradePlanEl.innerHTML = "";
      return;
    }

    const budget = state.upgradeXpBudget || DEFAULT_UPGRADE_XP_BUDGET;
    const plan = buildUpgradePlan(activeLoadout() || {}, weights, budget);
    upgradePlanEl.innerHTML = "";

    const names = (items) => items.map((it) => it.name).join(", ");
    const cappedNote = plan.capped.length
      ? ` Nothing more for ${names(plan.capped)} — this hero is already past the `
        + `Army command ceiling on what they move.`
      : "";
    const unweightedNote = plan.unweighted.length
      ? ` ${names(plan.unweighted)} gain${plan.unweighted.length === 1 ? "s" : ""} nothing `
        + `you're weighting.`
      : "";
    const notes = cappedNote + unweightedNote;

    if (!plan.rows.length) {
      upgradePlanSummaryEl.textContent = !plan.equippedCount
        ? "Nothing equipped yet — pick gear or auto-optimize, and this will say what's worth levelling."
        : !plan.upgradeableCount
          ? "Every piece in this loadout is already at its level cap."
          : plan.outbid.length
            ? `${budget.toLocaleString()} XP isn't enough for a single level — `
              + `the cheapest costs ${plan.cheapestStep.toLocaleString()} XP.`
            : `No piece gains anything from more levels.${notes}`;
      return;
    }

    // What the leftover means is the difference between "spend it all as
    // listed" and "you're a few hundred XP short of one more level", so the
    // summary says which rather than just reporting a remainder.
    const spendNote = plan.leftover <= 0
      ? "Spends all of it."
      : plan.cheapestUnbought
        ? `Spends ${plan.spent.toLocaleString()}; the ${plan.leftover.toLocaleString()} left over `
          + `is short of the next level anywhere, cheapest at ${plan.cheapestUnbought.toLocaleString()} XP.`
        : `Spends ${plan.spent.toLocaleString()} — nothing else in this loadout is worth levelling.`;
    // The rows are shares of one pot, so their gains add up — and this is what
    // they add up to. Worth stating: it's the figure the whole exercise is
    // about, and no single row carries it.
    const totalEntries = plan.armyGains ? Object.entries(plan.armyGains) : [];
    const totalNote = totalEntries.length
      ? ` Together that's ${totalEntries
          .map(([key, delta]) => `${STAT_LABELS[key]} +${(delta * 100).toFixed(2)}%`)
          .join(" · ")} Army command.`
      : "";
    const outbidNote = plan.outbid.length
      ? ` Nothing for ${names(plan.outbid)} at this budget — every XP does more elsewhere.`
      : "";

    upgradePlanSummaryEl.textContent =
      `How to split the next ${budget.toLocaleString()} XP across this loadout, biggest share `
      + `first. ${spendNote}${totalNote}${notes}${outbidNote}`;

    const best = plan.rows[0].benefit;
    for (const row of plan.rows) {
      const li = document.createElement("li");
      li.className = `upgrade-plan-row rarity-${row.item.rarity}`;
      const relative = best > 0 ? Math.round((row.benefit / best) * 100) : 0;

      // Real buff movement when there's a hero to measure it against, the flat
      // stat change when there isn't. The "Command" label leads the line once
      // rather than repeating per stat: it's what stops "Attack +0.28%" reading
      // as the Attack% stat roll, but saying it three times pushed the line to
      // two rows and left a separator dangling at the wrap.
      const armyEntries = row.armyGains ? Object.entries(row.armyGains) : [];
      const flatText = Object.entries(row.statGains)
        .map(([key, delta]) => `${fmtValue(key, delta)} ${STAT_LABELS[key]}`)
        .join(" · ");

      li.title = `${row.item.name} to level ${row.targetLevel}: ${flatText || "no flat stat change"}. `
        + `Percentage rolls don't change with level.`;

      const head = document.createElement("div");
      head.className = "upgrade-plan-head";
      const name = document.createElement("span");
      name.className = "upgrade-plan-name";
      name.textContent = row.item.name;
      head.appendChild(name);
      const value = document.createElement("span");
      value.className = "upgrade-plan-value";
      value.textContent = `${row.xp.toLocaleString()} XP`;
      value.title = `${row.xp.toLocaleString()} of the ${budget.toLocaleString()} XP — `
        + `${Math.round(row.share * 100)}% of the pot`
        + (row.wantsMore
          ? `, and this piece would take more of it if there were more to give.`
          : row.levelsLeft
            ? `, which is as far as this piece is worth taking.`
            : `, which caps it.`);
      head.appendChild(value);
      li.appendChild(head);

      const meta = document.createElement("div");
      meta.className = "upgrade-plan-meta";
      const tail = row.levelsLeft === 0
        ? `caps it`
        : row.wantsMore
          ? `${row.levelsLeft} more if the budget grows`
          : `stop there — the last ${row.levelsLeft} buy nothing`;
      meta.textContent = `Lv ${row.item.level} → ${row.targetLevel} · `
        + `+${row.levels} level${row.levels === 1 ? "" : "s"} · ${tail}`;
      li.appendChild(meta);

      if (armyEntries.length || flatText) {
        const statsEl = document.createElement("div");
        statsEl.className = "upgrade-plan-stats";
        if (armyEntries.length) {
          const lead = document.createElement("span");
          lead.className = "upgrade-plan-stats-lead";
          lead.textContent = "Command";
          statsEl.appendChild(lead);
          armyEntries.forEach(([key, delta], i) => {
            statsEl.appendChild(document.createTextNode(" "));
            // Each stat and its number travel together, and the separator
            // leads the pair rather than trailing it — so when the line wraps
            // it breaks between pairs and the "·" starts the new line instead
            // of dangling at the end of the old one.
            const part = document.createElement("span");
            part.className = "upgrade-plan-gain-part";
            markIfUnweighted(part, key, weights);
            part.appendChild(document.createTextNode(
              `${i ? "· " : ""}${STAT_LABELS[key]} `
            ));
            const gain = document.createElement("b");
            gain.className = "upgrade-plan-gain";
            gain.textContent = `+${(delta * 100).toFixed(2)}%`;
            part.appendChild(gain);
            statsEl.appendChild(part);
          });
        } else {
          statsEl.textContent = flatText;
        }
        li.appendChild(statsEl);
      }

      li.appendChild(planValueBar(relative));

      upgradePlanEl.appendChild(li);
    }
  }

  /** The PvP shop's set bonuses are every one of them conditional on Player
   * Combat (see set-bonuses.js), so this panel scores in that scenario whatever
   * the Auto-optimize menu is set to. Scoring PvP gear under "General" would
   * zero out the exact bonuses that make a second piece of a set worth buying,
   * and the panel would then recommend mixing the two sets — which is the one
   * answer that's reliably wrong. */
  const PVP_PLAN_CONTEXT = "playerCombat";

  /** Combined gear + set-bonus stats for a loadout given as item OBJECTS.
   *
   * combinedStatsForLoadout can't serve here: it resolves slot -> id -> item
   * through the inventory, and a shop piece you haven't bought isn't in the
   * inventory to resolve. */
  function statsForItemSet(items) {
    const totals = {};
    for (const key of Object.keys(STAT_LABELS)) totals[key] = 0;
    for (const it of items) {
      const stats = scoreStats(it);
      for (const key of Object.keys(STAT_LABELS)) totals[key] += stats[key] || 0;
    }
    const bonuses = computeActiveSetBonusStats(items, PVP_PLAN_CONTEXT);
    for (const [key, value] of Object.entries(bonuses)) {
      totals[key] = (totals[key] || 0) + value;
    }
    return totals;
  }

  /** A shop piece as it would land in this slot, carrying the same cached
   * level-ceiling annotation every inventory item has. */
  function pvpCandidateFor(shopItem, current) {
    const repl = pvpReplacementItem(shopItem, current);
    annotateProjections([repl]);
    return repl;
  }

  /** The order to buy PvP gear in, cheapest-decision-first is NOT the rule —
   * biggest gain is.
   *
   * Greedy, one purchase at a time, re-scoring the WHOLE loadout after each.
   * That's what makes set bonuses fall out on their own rather than needing a
   * special case: the second Warden piece is scored in a loadout that already
   * has the first, so the +0.4% it unlocks lands on that row and pushes it up
   * the list. It's also why the plan is a sequence and not six independent
   * comparisons — buying the Aegis changes what the Greathelm is worth.
   *
   * One purchase per slot, and the piece it replaces is gone: it was scrapped
   * to level the replacement, which is where the XP in the row came from.
   *
   * Stops when nothing left in the shop improves the loadout, which is a real
   * answer and not a failure — a slot holding a well-levelled piece with good
   * percentage rolls often beats a shop piece that arrives at level 15. */
  function buildPvpBuyPlan(loadout, weights) {
    const current = {};
    for (const slot of SLOT_ORDER) {
      current[slot] = loadout && loadout[slot] ? itemById(slot, loadout[slot]) : null;
    }

    // Matched on name as well as defId, because only a CSV import carries the
    // game's own equipment_definition_id — a backup restored from an older
    // export, or the sample data, identifies the same piece by name alone. Name
    // is safe to match on here: these are the game's fixed item names, and the
    // shop sells one piece per name.
    const owned = new Set();
    for (const list of Object.values(state.itemsBySlot || {})) {
      for (const it of list) {
        if (it.defId) owned.add(it.defId);
        if (it.name) owned.add(it.name);
      }
    }

    const chosen = {};
    const rows = [];
    let spend = 0;

    // Bounded by the slot count — every pass either commits a slot or stops.
    for (let pass = 0; pass < SLOT_ORDER.length; pass++) {
      const equipped = SLOT_ORDER.map((s) => chosen[s] || current[s]).filter(Boolean);
      const beforeStats = statsForItemSet(equipped);
      const beforeScore = scoreLoadoutStats(beforeStats, weights);

      let best = null;
      for (const shopItem of PVP_SHOP_ITEMS) {
        if (chosen[shopItem.slot]) continue;
        const repl = pvpCandidateFor(shopItem, current[shopItem.slot]);
        const trial = equipped.filter((it) => it.slot !== shopItem.slot).concat([repl]);
        const afterStats = statsForItemSet(trial);
        const gain = scoreLoadoutStats(afterStats, weights) - beforeScore;
        // Ties break to the cheaper piece — the two sets are mirror images in
        // several slots, so an exact tie is a real outcome here, not a rounding
        // artefact, and the Epic at 5,000 is the better buy at equal value.
        const better = !best || gain > best.gain
          || (gain === best.gain && shopItem.cost < best.shopItem.cost);
        if (better) best = { shopItem, repl, gain, beforeStats, afterStats };
      }

      if (!best || best.gain <= 0) break;

      const { shopItem, repl } = best;
      const replaced = current[shopItem.slot];
      spend += shopItem.cost;

      const statGains = {};
      for (const key of Object.keys(STAT_LABELS)) {
        const delta = (best.afterStats[key] || 0) - (best.beforeStats[key] || 0);
        if (PERCENT_STATS.has(key) ? Math.abs(delta) > 0.00005 : Math.round(delta)) {
          statGains[key] = delta;
        }
      }

      rows.push({
        shopItem,
        repl,
        replaced,
        gain: best.gain,
        cost: shopItem.cost,
        cumulativeCost: spend,
        statGains,
        armyDeltas: armyCommandDeltas(best.beforeStats, best.afterStats),
        alreadyOwned: owned.has(shopItem.defId) || owned.has(shopItem.name),
      });
      chosen[shopItem.slot] = repl;
    }

    const heldSlots = SLOT_ORDER.filter((slot) => !chosen[slot] && current[slot]);
    return {
      rows,
      totalCost: spend,
      heldSlots,
      heldNames: heldSlots.map((slot) => current[slot].name),
      equippedCount: SLOT_ORDER.filter((slot) => current[slot]).length,
    };
  }

  function renderPvpBuyPlan() {
    if (!pvpPlanWrapEl || !pvpPlanEl) return;
    // Every row here is "this shop piece instead of THAT piece, on this hero's
    // breakpoint curves" — with no hero, or nothing equipped to trade in, there
    // is no question for it to answer, so it stays shut and its heading stops
    // being a control. The preference itself is left alone: pick a geared hero
    // and the panel comes back however you last left it.
    const ready = Boolean(activeHero())
      && selectedItemsForLoadout(activeLoadout() || {}).length > 0;
    const open = state.showPvpPlan && ready;
    if (pvpPlanToggleEl) {
      pvpPlanToggleEl.disabled = !ready;
      pvpPlanToggleEl.title = ready
        ? ""
        : "Pick a hero and equip some gear — this panel ranks shop pieces against "
          + "what that hero is wearing now.";
    }
    applyPanelOpenState(pvpPlanWrapEl, pvpPlanToggleEl, pvpPlanBodyEl, open);
    // Collapsed, the greedy walk below is pure waste — it re-scores the whole
    // loadout once per shop piece per purchase.
    if (!open) return;
    const weights = state.optimizeWeights;
    pvpPlanEl.innerHTML = "";

    if (optimizeWeightCount() === 0) {
      pvpPlanSummaryEl.textContent =
        "Give at least one stat a weight in Auto-optimize — this panel ranks shop pieces "
        + "by the same weighted score, so with none set there's nothing to rank them on.";
      return;
    }

    const plan = buildPvpBuyPlan(activeLoadout() || {}, weights);

    // Said once here rather than on every row: both are properties of the shop,
    // not of any particular piece.
    const caveat = ` Neither the random affixes nor the quality roll is scored — `
      + `both are unknown until the piece is bought — so every row understates a `
      + `little. Each row lists what its piece could roll.`
      // The panel's usual premise is what the scrap XP buys you NOW, and
      // max-level scoring suspends exactly that: the arrival level stops
      // separating the candidates once every one of them is measured at its
      // cap. That changes the question the order answers, so it's said up
      // front rather than left to be inferred from the rows.
      + (state.maxLevelScoring
        ? ` Max level gear is on, so every piece — shop and equipped alike — is `
          + `scored at its cap. This is the endgame buy order, not the one that `
          + `does the most for you today.`
        : "");

    // The empty-loadout case can't reach here — the panel doesn't open without
    // equipped gear (see `ready` above), so an empty plan means the shop lost.
    if (!plan.rows.length) {
      pvpPlanSummaryEl.textContent =
        `Nothing in the PvP shop improves this loadout. Your current pieces already beat `
        + `every piece it sells, scored on your weights.${caveat}`;
      return;
    }

    const heldNote = plan.heldNames.length
      ? ` Nothing beats ${plan.heldNames.join(", ")}, so ${plan.heldSlots.length === 1 ? "that slot is" : "those slots are"} left alone.`
      : "";

    pvpPlanSummaryEl.textContent =
      `Buy in this order — each row is scored against the loadout the rows above it leave `
      + `behind, so set bonuses count where they'd actually land. `
      + `All ${plan.rows.length} costs ${plan.totalCost.toLocaleString()} ${PVP_SHOP_CURRENCY}.`
      + `${heldNote}${caveat}`;

    const best = plan.rows[0].gain;
    plan.rows.forEach((row, index) => {
      const li = document.createElement("li");
      const { shopItem, repl, replaced } = row;
      li.className = `upgrade-plan-row rarity-${shopItem.rarity}`;
      const relative = best > 0 ? Math.round((row.gain / best) * 100) : 0;

      const head = document.createElement("div");
      head.className = "upgrade-plan-head";
      const name = document.createElement("span");
      name.className = "upgrade-plan-name";
      name.textContent = `${index + 1}. ${shopItem.name}`;
      head.appendChild(name);
      const value = document.createElement("span");
      value.className = "upgrade-plan-value";
      value.textContent = `${shopItem.cost.toLocaleString()} ${PVP_SHOP_CURRENCY}`;
      value.title = `${row.cumulativeCost.toLocaleString()} ${PVP_SHOP_CURRENCY} `
        + `spent by the end of this row.`;
      head.appendChild(value);
      li.appendChild(head);

      const meta = document.createElement("div");
      meta.className = "upgrade-plan-meta";
      meta.textContent = replaced
        ? `${shopItem.rarity} ${shopItem.slot.toLowerCase()}`
        : `${shopItem.rarity} ${shopItem.slot.toLowerCase()} · fills an empty slot`;
      li.appendChild(meta);

      // The level line is the point of the whole panel, so it gets its own row
      // rather than being folded into the one above: a Legendary landing BELOW
      // the level of the Epic it replaced looks like a bug until you see the XP
      // that bought it and the cap it's climbing towards.
      const levels = document.createElement("div");
      levels.className = "upgrade-plan-meta";
      const arrival = `Arrives Lv ${PVP_SHOP_ARRIVAL_LEVEL}`;
      const climb = repl.levelsFromXp > 0
        ? ` → Lv ${repl.level} on ${repl.xpInherited.toLocaleString()} XP from the scrap`
        : replaced
          ? ` · the ${repl.xpInherited.toLocaleString()} XP from the scrap doesn't buy a level here`
          : "";
      // Max-level scoring takes the arrival level out of the comparison
      // entirely — both this piece and the one it replaces are scored at their
      // caps — so the line has to stop reading as the basis for the gains
      // below it. Said on every row rather than once in the summary, because
      // it's the one line those gains would otherwise be read against.
      const basis = state.maxLevelScoring
        ? ` · scored at its Lv ${repl.projectedMaxLevel} cap, not on arrival`
        : "";
      levels.textContent = `${arrival}${climb}${basis}`;
      if (repl.xpWasted > 0) {
        levels.textContent += ` · ${repl.xpWasted.toLocaleString()} XP stranded at the cap`;
      }
      li.appendChild(levels);

      // Both directions, and in the stat order the Army panel uses rather than
      // best-first — a swap is a trade, and sorting the wins above the losses
      // would be editorialising about which half matters.
      const armyEntries = row.armyDeltas
        ? BREAKPOINT_STAT_ORDER.filter((key) => row.armyDeltas[key])
          .map((key) => [key, row.armyDeltas[key]])
        : [];
      const flatText = Object.entries(row.statGains)
        .map(([key, delta]) => `${fmtValue(key, delta)} ${STAT_LABELS[key]}`)
        .join(" · ");
      const canRoll = PVP_AFFIX_POOLS[shopItem.affixTheme] || [];
      // The roll pool is on the row itself now, so the tooltip carries only
      // what the row can't: the full raw stat change, and the fact that it is
      // the guaranteed base rather than anything rolled.
      li.title = `${shopItem.name}, against ${replaced ? replaced.name : "an empty slot"}: `
        + `${flatText || "no net stat change"}. Guaranteed base stats — nothing here is rolled.`;

      /** One "Label +0.00% · Label -0.00%" line, each stat and its number kept
       * together so a wrap breaks between pairs. `suffix` adds unemphasised
       * text after the figure, inside the same unbreakable pair. */
      const statLine = (leadText, entries, format, suffix) => {
        const el = document.createElement("div");
        el.className = "upgrade-plan-stats";
        const lead = document.createElement("span");
        lead.className = "upgrade-plan-stats-lead";
        lead.textContent = leadText;
        el.appendChild(lead);
        entries.forEach(([key, delta], i) => {
          el.appendChild(document.createTextNode(" "));
          const part = document.createElement("span");
          part.className = "upgrade-plan-gain-part";
          markIfUnweighted(part, key, weights);
          part.appendChild(document.createTextNode(`${i ? "· " : ""}${STAT_LABELS[key]} `));
          const gain = document.createElement("b");
          gain.className = delta < 0 ? "upgrade-plan-gain upgrade-plan-loss" : "upgrade-plan-gain";
          gain.textContent = format(key, delta);
          part.appendChild(gain);
          const extra = suffix && suffix(key, delta);
          if (extra) part.appendChild(document.createTextNode(` ${extra}`));
          el.appendChild(part);
        });
        return el;
      };

      // The buff percentage AND the raw stat behind it. The percentage is what
      // the hero actually gains, but it's the output of a curve — two pieces
      // adding the same raw Health buy different percentages depending on where
      // on that curve the hero is standing, and a reader with no raw number has
      // no way to tell a small stat from a flat part of the curve. Both, and
      // the row explains itself.
      if (armyEntries.length) {
        li.appendChild(statLine(
          "Command",
          armyEntries,
          (key, delta) => `${delta > 0 ? "+" : "-"}${(Math.abs(delta) * 100).toFixed(2)}%`,
          (key) => (row.statGains[key] ? `(${fmtValue(key, row.statGains[key])})` : ""),
        ));
      }

      // Everything the Command line doesn't cover. A swap replaces an item's
      // percentage rolls wholesale — unlike levelling it, which can't move them
      // at all — so these are frequently the entire reason a row scores
      // positive. Left out, a row that trades Army stats for PvP Attack reads
      // as a recommendation to make the loadout worse.
      const otherEntries = Object.entries(row.statGains)
        .filter(([key]) => !BREAKPOINT_STAT_KEYS.has(key));
      if (armyEntries.length && otherEntries.length) {
        li.appendChild(statLine("Also", otherEntries, (key, delta) => fmtValue(key, delta)));
      } else if (!armyEntries.length && flatText) {
        // No hero to run a curve against — the raw stat change is the only
        // honest thing to report, core stats included.
        const statsEl = document.createElement("div");
        statsEl.className = "upgrade-plan-stats";
        statsEl.textContent = flatText;
        li.appendChild(statsEl);
      }

      // What the piece could roll on top of everything scored above. Listed per
      // row rather than once for the panel because the two sets draw from
      // disjoint pools (see PVP_AFFIX_POOLS): a Conqueror piece cannot roll a
      // health affix and a Warden one can, which is exactly the sort of thing a
      // blanket "affixes aren't scored" footnote lets a reader assume wrong.
      if (canRoll.length) {
        const rolls = document.createElement("div");
        rolls.className = "upgrade-plan-meta pvp-plan-rolls";
        rolls.textContent = `${shopItem.affixTheme} (${shopItem.affixSlots}): ${canRoll.join(", ")}`;
        li.appendChild(rolls);
      }

      if (row.alreadyOwned) {
        const owned = document.createElement("div");
        owned.className = "upgrade-plan-meta pvp-plan-owned";
        owned.textContent = "You already own one of these — this row is a second copy.";
        li.appendChild(owned);
      }

      li.appendChild(planValueBar(relative));

      pvpPlanEl.appendChild(li);
    });
  }

  function renderArmyCommand() {
    if (!armyCommandWrapEl || !armyCommandEl) return;
    const hero = activeHero();
    if (!hero || !hero.statTotals) {
      armyCommandWrapEl.hidden = true;
      return;
    }
    const rarity = hero.rarity || DEFAULT_HERO_RARITY;
    const totals = heroStatTotalsFor(hero, combinedStatsForLoadout(activeLoadout() || {}));

    armyCommandEl.innerHTML = "";
    for (const [statKey, { kind }] of Object.entries(BREAKPOINT_STATS)) {
      const raw = Math.round(totals[statKey]);
      const percent = heroStatPercent(rarity, kind, raw);
      const capPoint = heroStatCapPoint(rarity, kind);
      const capped = raw >= capPoint;
      const capPercent = (heroStatPercent(rarity, kind, capPoint) * 100).toFixed(1);
      const label = STAT_LABELS[statKey];

      const row = document.createElement("li");
      row.className = "ledger-row";
      // The raw stat and the cap live here rather than on the line: they're
      // what you check once, not what you scan.
      row.title = capped
        ? `${raw.toLocaleString()} ${label} — already past the +${capPercent}% ceiling `
          + `${rarity} heroes hit at ${Math.round(capPoint).toLocaleString()}, so more flat ${label} is worth nothing.`
        : `${raw.toLocaleString()} ${label} — ${rarity} heroes reach their +${capPercent}% `
          + `ceiling at ${Math.round(capPoint).toLocaleString()}.`;

      const labelEl = document.createElement("span");
      labelEl.className = "ledger-row-label";
      labelEl.textContent = label;
      row.appendChild(labelEl);

      const value = document.createElement("span");
      value.className = "ledger-row-value";

      // How far off the ceiling this stat is, which is the number you act on:
      // past it, more of the flat stat buys nothing; short of it, this is
      // exactly how much more is still worth chasing.
      const cap = document.createElement("span");
      cap.className = "army-command-cap" + (capped ? " is-over" : "");
      cap.textContent = capped
        ? `${(raw - capPoint).toLocaleString()} over cap`
        : `${(capPoint - raw).toLocaleString()} until cap`;
      value.appendChild(cap);

      value.appendChild(document.createTextNode(`+${(percent * 100).toFixed(1)}%`));
      row.appendChild(value);

      armyCommandEl.appendChild(row);
    }
    armyCommandWrapEl.hidden = false;
  }

  function renderLedger(totals, setNotes) {
    ledgerEl.innerHTML = "";
    if (!totals.length) {
      const empty = document.createElement("p");
      empty.className = "ledger-empty";
      empty.textContent = "No items selected yet. Pick gear on the left, or auto-optimize above.";
      ledgerEl.appendChild(empty);
    } else {
      for (const row of totals) {
        const rowEl = document.createElement("div");
        rowEl.className = "ledger-row";

        const prevText = state.lastTotalsByKey[row.key];
        if (prevText !== undefined && prevText !== row.text) {
          rowEl.classList.add("flash");
        }

        const label = document.createElement("span");
        label.className = "ledger-row-label";
        label.textContent = row.label;
        rowEl.appendChild(label);

        const value = document.createElement("span");
        value.className = "ledger-row-value";
        value.textContent = row.text.replace(row.label + " ", "");
        rowEl.appendChild(value);

        ledgerEl.appendChild(rowEl);
      }
    }

    const newLastTotals = {};
    for (const row of totals) newLastTotals[row.key] = row.text;
    state.lastTotalsByKey = newLastTotals;

    if (setNotes.length) {
      setNotesWrapEl.hidden = false;
      setNotesEl.innerHTML = "";
      for (const note of setNotes) {
        const li = document.createElement("li");
        li.textContent = note;
        setNotesEl.appendChild(li);
      }
    } else {
      setNotesWrapEl.hidden = true;
    }
  }

  /** The ledger's own note that its numbers are projections. Lives with the
   * totals rather than with the toggle: the slot cards carry "Lvl 12 → 37" on
   * every piece, but a stat total has nothing on it to give the basis away. */
  function updateMaxLevelNotice() {
    if (maxLevelNoticeEl) maxLevelNoticeEl.hidden = !state.maxLevelScoring;
  }

  function refreshTotals() {
    // Equipping gear moves the hero along their breakpoint curves, so the
    // flat-stat divisors have to follow. Every loadout mutation ends here, which
    // makes this the one chokepoint that keeps them in step. Auto-optimize
    // moves the divisors itself mid-run and puts them back afterwards (see
    // optimizeLoadout), so what it leaves behind is whatever the loadout it
    // just applied deserves — which this then recomputes anyway.
    refreshBreakpointScale();
    updateMaxLevelNotice();
    const { totals, setNotes } = computeTotals(activeLoadout());
    renderLedger(totals, setNotes);
    renderArmyCommand();
    renderUpgradePlan();
    renderPvpBuyPlan();
  }

  function clearAll() {
    const owner = state.activeOwner;
    const blank = {};
    for (const slot of state.slotOrder) blank[slot] = null;
    state.loadoutsByOwner[owner] = blank;
    saveLoadouts();
    invalidatePendingLiveEquip();
    renderSlots();
    refreshTotals();
  }

  /** Blank slate: wipe every hero's loadout AND the no-hero scratch space,
   * unlike clearAll() which only wipes whichever loadout is active. */
  function clearAllHeroesLoadouts() {
    const blank = {};
    for (const slot of state.slotOrder) blank[slot] = null;
    state.loadoutsByOwner = { [NO_HERO_OWNER]: { ...blank } };
    for (const hero of state.heroes) {
      state.loadoutsByOwner[hero.id] = { ...blank };
    }
    saveLoadouts();
    // The hero stays selected: this empties every loadout, and being dropped
    // to the scratch space on top of that means re-picking the hero before you
    // can start rebuilding. Their loadout was just blanked with the rest.
    ensureOwnerLoadout(state.activeOwner);
    refreshBreakpointScale();
    invalidatePendingLiveEquip();
    renderSlots();
    refreshTotals();
    showToast("Cleared every hero's loadout.");
  }

  function availableRarities(equipment) {
    const present = new Set(equipment.map((it) => it.rarity));
    return RARITY_ORDER.filter((r) => present.has(r));
  }

  function renderFilterMenu() {
    filterCheckboxListEl.innerHTML = "";
    for (const key of state.availableStats) {
      const label = document.createElement("label");
      label.className = "filter-checkbox-item";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = key;
      checkbox.checked = state.activeStatFilters.has(key);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) state.activeStatFilters.add(key);
        else state.activeStatFilters.delete(key);
        updateFilterCountBadge();
        renderSlots();
      });

      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(STAT_LABELS[key] || key));
      filterCheckboxListEl.appendChild(label);
    }

    rarityCheckboxListEl.innerHTML = "";
    for (const rarity of state.availableRarities) {
      const label = document.createElement("label");
      label.className = "filter-checkbox-item rarity-" + rarity;

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = rarity;
      checkbox.checked = state.activeRarityFilters.has(rarity);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) state.activeRarityFilters.add(rarity);
        else state.activeRarityFilters.delete(rarity);
        updateFilterCountBadge();
        renderSlots();
      });

      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(rarity));
      rarityCheckboxListEl.appendChild(label);
    }
  }

  function updateFilterCountBadge() {
    const count = state.activeStatFilters.size + state.activeRarityFilters.size;
    filterCountBadgeEl.hidden = count === 0;
    filterCountBadgeEl.textContent = count;
  }

  function clearStatFilters() {
    state.activeStatFilters.clear();
    state.activeRarityFilters.clear();
    renderFilterMenu();
    updateFilterCountBadge();
    renderSlots();
  }

  function handleOptimizeRun() {
    const weights = state.optimizeWeights;
    if (optimizeWeightCount() === 0) {
      showToast("Give at least one stat a weight first.");
      return;
    }
    const lockedMap = computeLockedMap();
    const excludeIds = new Set(
      [...lockedMap.keys()].filter(
        (itemId) => heroGroupKey(lockedMap.get(itemId)) !== heroGroupKey(state.activeOwner)
      )
    );
    const currentLoadout = activeLoadout();
    const lockedSlots = lockedSlotsForOwner(state.activeOwner);
    const search = optimizeLoadout(
      state.itemsBySlot, weights, excludeIds, currentLoadout, lockedSlots
    );
    const loadout = search.loadout;
    state.loadoutsByOwner[state.activeOwner] = loadout;
    saveLoadouts();
    invalidatePendingLiveEquip();
    renderSlots();
    refreshTotals();
    closeOptimizeMenu();
    const weightedNames = Object.keys(weights).filter((k) => weights[k]).map((k) => STAT_LABELS[k] || k);
    const lockedCount = lockedSlots.size;
    const lockedNote = lockedCount ? ` (${lockedCount} slot${lockedCount === 1 ? "" : "s"} left locked)` : "";
    const ctxOption = optimizeContextOptions().find((o) => o.value === state.optimizeContext);
    const ctxNote = ctxOption ? ` · ${ctxOption.label}` : "";
    const maxLevelNote = state.maxLevelScoring ? " · gear at max level" : "";
    // Worth saying which one you got: an exhausted search is a proof, a
    // budget-capped one is just the best found so far.
    const searchNote = search.exhaustive
      ? ` Best of ${search.combinations.toLocaleString()} combinations.`
      : ` Stopped at ${search.leaves.toLocaleString()} of ${search.combinations.toLocaleString()} `
        + `combinations — best found, not provably the best.`;
    showToast(
      `Auto-optimized for ${weightedNames.join(", ")}${ctxNote}${maxLevelNote}${lockedNote}.${searchNote}`
    );
  }

  function switchOwner(newOwner) {
    state.activeOwner = newOwner;
    saveActiveOwner();
    ensureOwnerLoadout(newOwner);
    refreshBreakpointScale();
    invalidatePendingLiveEquip();
    renderSlots();
    refreshTotals();
  }

  function init() {
    const savedEquipment = loadSavedEquipmentData();
    const initialData = savedEquipment || {
      heroes: SAMPLE_HEROES,
      equipment: SAMPLE_EQUIPMENT,
      knownSetSizes: SAMPLE_KNOWN_SET_SIZES,
    };
    state.heroes = initialData.heroes;
    state.showUpgradePlan = loadPanelOpen(SHOW_UPGRADE_PLAN_STORAGE_KEY, false);
    state.showPvpPlan = loadPanelOpen(SHOW_PVP_PLAN_STORAGE_KEY, true);
    state.upgradeXpBudget = loadSavedUpgradeXpBudget();
    state.itemsBySlot = groupBySlot(annotateProjections(initialData.equipment));
    state.statScale = computeStatScale(initialData.equipment);
    state.availableStats = availableStats(initialData.equipment);
    state.availableRarities = availableRarities(initialData.equipment);
    state.knownSetSizes = initialData.knownSetSizes || {};
    state.isSampleData = !savedEquipment;
    state.isLive = false;
    if (sampleBannerEl) sampleBannerEl.hidden = !state.isSampleData;

    state.loadoutsByOwner = loadSavedLoadouts();
    state.lockedSlotsByOwner = loadSavedLockedSlots();
    state.customTroopPresets = loadSavedTroopPresets();
    state.gearMultipliers = loadSavedGearMultipliers();
    state.activeOwner = loadSavedActiveOwner();
    // The saved hero may be gone, or back under a different id, since the last
    // visit — the same problem a data swap has, so it gets the same treatment.
    retainActiveOwner();
    ensureOwnerLoadout(state.activeOwner);
    // Only now: the scale is read off the active hero standing in their
    // loadout, and neither of those existed until this point.
    refreshBreakpointScale();

    restoreOptimizeSetup();
    // The scale above was computed before the saved setup was known, and a
    // restored max-level toggle changes the numbers it was taken from.
    refreshStatScale();
    if (optimizeMaxLevelEl) optimizeMaxLevelEl.checked = state.maxLevelScoring;

    renderHeroSelect();
    renderOptimizeContextSelect();
    // A preset fills in only the stats the inventory had when it was picked,
    // and this inventory may not be that one — so when the dropdown names a
    // preset, re-derive the weights from it rather than trusting the saved
    // list. Custom weights have nothing to re-derive from and stand as saved.
    if (!reapplyActiveTroopPreset()) {
      renderOptimizeWeightList();
      updateOptimizeWeightBadge();
    }
    updateTroopPresetControls();
    renderFilterMenu();
    updateFilterCountBadge();
    renderSlots();
    refreshTotals();

    heroSelectEl.addEventListener("change", () => {
      switchOwner(heroSelectEl.value);
    });
    optimizeMenuBtnEl.addEventListener("click", () => {
      optimizeMenuListEl.hidden ? openOptimizeMenu() : closeOptimizeMenu();
    });
    optimizeClearBtnEl.addEventListener("click", () => {
      state.optimizeWeights = {};
      // Same rule as editing a weight by hand or hitting Only: the weights are
      // the player's now, so the dropdown must stop claiming a preset. Left
      // naming one, it reads as "Archer is applied" over an empty weight list,
      // and Optimize answers with "give at least one stat a weight first".
      optimizeTroopSelectEl.value = "custom";
      saveOptimizeSetup();
      renderOptimizeWeightList();
      updateOptimizeWeightBadge();
    });
    optimizeMaxLevelEl.addEventListener("change", () => {
      setMaxLevelScoring(optimizeMaxLevelEl.checked);
    });
    optimizeContextSelectEl.addEventListener("change", () => {
      state.optimizeContext = optimizeContextSelectEl.value;
      // The choice is the player's from here on, so no later preset gets to
      // revert it — see presetAppliedScenario.
      forgetPresetScenario();
      saveOptimizeSetup();
    });
    optimizeTroopSelectEl.addEventListener("change", () => {
      applyTroopPreset(optimizeTroopSelectEl.value);
    });
    optimizeTroopSaveSelectEl.addEventListener("change", updateTroopPresetControls);
    optimizeTroopSaveBtnEl.addEventListener("click", () => {
      saveTroopPreset(optimizeTroopSaveSelectEl.value);
    });
    optimizeTroopResetBtnEl.addEventListener("click", () => {
      resetTroopPreset(optimizeTroopSaveSelectEl.value);
    });
    optimizeRunBtnEl.addEventListener("click", handleOptimizeRun);
    // Panel visibility only — nothing about the loadout, the ledger or the
    // scoring basis moves with either of these, so each repaints just itself.
    bindPanelToggle(
      upgradePlanToggleEl, "showUpgradePlan", SHOW_UPGRADE_PLAN_STORAGE_KEY, renderUpgradePlan,
    );
    bindPanelToggle(
      pvpPlanToggleEl, "showPvpPlan", SHOW_PVP_PLAN_STORAGE_KEY, renderPvpBuyPlan,
    );
    if (upgradePlanBudgetEl) {
      upgradePlanBudgetEl.value = String(state.upgradeXpBudget);
      upgradePlanBudgetEl.addEventListener("input", () => {
        const raw = Number(upgradePlanBudgetEl.value);
        state.upgradeXpBudget = Number.isFinite(raw) && raw > 0
          ? Math.floor(raw)
          : DEFAULT_UPGRADE_XP_BUDGET;
        saveUpgradeXpBudget();
        // Only the plan depends on the budget — the loadout, the ledger and
        // the breakpoint scale are untouched by it, so this repaints just the
        // one panel instead of going through refreshTotals().
        renderUpgradePlan();
      });
    }
    itemSearchInputEl.addEventListener("input", () => {
      state.globalSearchQuery = itemSearchInputEl.value.trim().toLowerCase();
      renderSlots();
    });
    pickerSearchInputEl.addEventListener("input", () => {
      state.pickerSearchQuery = pickerSearchInputEl.value.trim().toLowerCase();
      renderPickerList(pickerCompareBarEl.dataset.slot);
    });
    pickerFilterMenuBtnEl.addEventListener("click", () => {
      pickerFilterMenuListEl.hidden ? openPickerFilterMenu() : closePickerFilterMenu();
    });
    pickerFilterClearBtnEl.addEventListener("click", () => {
      state.pickerStatFilters.clear();
      renderPickerFilterMenu();
      updatePickerFilterCountBadge();
      renderPickerList(pickerCompareBarEl.dataset.slot);
    });
    clearBtnEl.addEventListener("click", clearAll);
    pickerCloseEl.addEventListener("click", closePicker);
    overlayEl.addEventListener("click", (e) => {
      if (e.target === overlayEl) closePicker();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !overlayEl.hidden) closePicker();
      if (e.key === "Escape" && !dataMenuListEl.hidden) closeDataMenu();
      if (e.key === "Escape" && !filterMenuListEl.hidden) closeFilterMenu();
      if (e.key === "Escape" && !optimizeMenuListEl.hidden) closeOptimizeMenu();
      if (e.key === "Escape" && !pickerFilterMenuListEl.hidden) closePickerFilterMenu();
    });

    dataMenuBtnEl.addEventListener("click", () => {
      dataMenuListEl.hidden ? openDataMenu() : closeDataMenu();
    });
    filterMenuBtnEl.addEventListener("click", () => {
      filterMenuListEl.hidden ? openFilterMenu() : closeFilterMenu();
    });
    document.addEventListener("click", (e) => {
      if (!dataMenuListEl.hidden && !e.target.closest(".data-menu")) closeDataMenu();
      if (!filterMenuListEl.hidden && !e.target.closest(".data-menu")) closeFilterMenu();
      if (!optimizeMenuListEl.hidden && !e.target.closest(".data-menu")) closeOptimizeMenu();
      if (!pickerFilterMenuListEl.hidden && !e.target.closest(".data-menu")) closePickerFilterMenu();
    });
    filterClearBtnEl.addEventListener("click", clearStatFilters);

    loadEquipmentCsvBtnEl.addEventListener("click", () => {
      closeDataMenu();
      loadEquipmentCsvInputEl.click();
    });
    loadEquipmentCsvInputEl.addEventListener("change", () => {
      const file = loadEquipmentCsvInputEl.files[0];
      loadEquipmentCsvInputEl.value = "";
      if (file) handleLoadEquipmentCsvFile(file);
    });

    pasteEquipmentCsvBtnEl.addEventListener("click", () => {
      closeDataMenu();
      openPasteCsvModal();
    });
    pasteCsvCloseEl.addEventListener("click", closePasteCsvModal);
    pasteCsvOverlayEl.addEventListener("click", (e) => {
      if (e.target === pasteCsvOverlayEl) closePasteCsvModal();
    });
    pasteCsvSubmitEl.addEventListener("click", handlePasteCsvSubmit);

    syncGearBtnEl.addEventListener("click", () => {
      closeDataMenu();
      handleSyncGear();
    });

    loadLoadoutsBtnEl.addEventListener("click", () => {
      closeDataMenu();
      loadLoadoutsInputEl.click();
    });
    loadLoadoutsInputEl.addEventListener("change", () => {
      const file = loadLoadoutsInputEl.files[0];
      loadLoadoutsInputEl.value = "";
      if (file) handleLoadBackupFile(file);
    });

    exportLoadoutsBtnEl.addEventListener("click", () => {
      closeDataMenu();
      exportBackup();
    });
    resetAllHeroesBtnEl.addEventListener("click", () => {
      closeDataMenu();
      clearAllHeroesLoadouts();
    });
    resetSampleBtnEl.addEventListener("click", () => {
      closeDataMenu();
      resetToSampleData();
    });

    compareBtnEl.addEventListener("click", openCompareModal);
    equipLiveBtnEl.addEventListener("click", handleLiveEquipClick);
    compareCloseEl.addEventListener("click", closeCompareModal);
    compareOverlayEl.addEventListener("click", (e) => {
      if (e.target === compareOverlayEl) closeCompareModal();
    });
    compareOwnerAEl.addEventListener("change", refreshLoadoutCompare);
    compareOwnerBEl.addEventListener("change", refreshLoadoutCompare);

    pickerCompareBtnEl.addEventListener("click", () => {
      const [a, b] = state.pickerCompareSelection;
      if (a && b) openItemCompareModal(pickerCompareBarEl.dataset.slot, a, b);
    });
    pickerCompareClearBtnEl.addEventListener("click", () => {
      state.pickerCompareSelection = [];
      for (const cb of pickerListEl.querySelectorAll(".picker-option-compare-checkbox")) cb.checked = false;
      updatePickerCompareBar();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !compareOverlayEl.hidden) closeCompareModal();
      if (e.key === "Escape" && !pasteCsvOverlayEl.hidden) closePasteCsvModal();
    });

    // Sample data is on screen but the user has imported before, so say why —
    // otherwise their account silently reverts to the demo inventory. Last in
    // init deliberately: a throw here must not cost the listeners above, which
    // would leave the whole UI inert rather than just missing a message.
    if (discardedStaleEquipmentData) {
      showToast("Your saved equipment data is from an older version — re-import your CSV to load it.");
    }
  }

  init();
})();
