/**
 * Known equipment set bonuses, read directly off in-game tooltips (2026-08).
 * Bonuses are CUMULATIVE across tiers — e.g. Prospector's Kit at 3 pieces
 * grants the 2-piece bonus AND the 3-piece bonus added together (4% + 6% =
 * 10% Gather Speed), not just the highest tier alone.
 *
 * Any setId NOT listed here falls back to an "unknown bonus" note in app.js —
 * this table only covers sets a guild member has actually screenshotted.
 *
 * Every set's bonus is CONDITIONAL on a scenario, named by `context`
 * (a stable key) and shown to the user via `appliesIn` (a display label).
 * Beastlord's +Attack/+Health, for example, is live ONLY inside Monster
 * Dens — so it must not sway scoring when you're optimizing army attack for
 * anything else. Sets with no condition should use context "always".
 */
const SET_BONUS_DEFS = {
  beast: {
    name: "Beastlord's Hunt",
    appliesIn: "Monster Dens",
    context: "monsterDen",
    totalPieces: 4,
    memberNames: ["Beastfang Dagger", "Wolfhide Vest", "Tracker's Hood", "Stalker Boots"],
    tiers: [
      { pieces: 2, bonuses: { attackPercent: 0.03 } },
      { pieces: 4, bonuses: { attackPercent: 0.06, healthPercent: 0.06 } },
    ],
  },
  gatherers: {
    name: "Prospector's Kit",
    appliesIn: "Gathering",
    context: "gathering",
    totalPieces: 3,
    memberNames: ["Miner's Pick", "Master Miner's Helm", "Merchant's Pouch"],
    tiers: [
      { pieces: 2, bonuses: { gatherSpeed: 0.04 } },
      { pieces: 3, bonuses: { gatherSpeed: 0.06 } },
    ],
  },
  conqueror: {
    name: "Conqueror's Regalia",
    appliesIn: "Player Combat",
    context: "playerCombat",
    totalPieces: 6,
    memberNames: [
      "Conqueror's Pendant",
      "Conqueror's Shroud",
      "Conqueror's Cowl",
      "Conqueror's Stalkers",
      "Conqueror's Fang",
      "Conqueror's Signet",
    ],
    tiers: [
      { pieces: 2, bonuses: { pvpAttack: 0.004 } },
      { pieces: 4, bonuses: { pvpAttack: 0.006 } },
      { pieces: 6, bonuses: { pvpAttack: 0.01 } },
    ],
  },
  warden: {
    name: "Warden's Vigil",
    appliesIn: "Player Combat",
    context: "playerCombat",
    totalPieces: 6,
    memberNames: [
      "Warden's Greaves",
      "Warden's Wardsword",
      "Warden's Bulwark",
      "Warden's Band",
      "Warden's Aegis",
      "Warden's Greathelm",
    ],
    tiers: [
      { pieces: 2, bonuses: { pvpDefense: 0.004 } },
      { pieces: 4, bonuses: { pvpDefense: 0.006 } },
      { pieces: 6, bonuses: { pvpDefense: 0.01 } },
    ],
  },
};

/**
 * Whether a set's bonuses should count toward scoring in a given context.
 * `activeContext === null` means "count everything regardless of scenario" —
 * used by the raw ledger, which shows every bonus and labels the conditional
 * ones. `"general"` means "only unconditional bonuses" — the safe default for
 * optimizing a stat (e.g. army attack) outside any special scenario, so a
 * Monster-Dens-only bonus doesn't skew the pick. Any other value matches a
 * set's own `context`, letting you deliberately optimize FOR that scenario.
 */
function setBonusAppliesInContext(def, activeContext) {
  if (activeContext === null || activeContext === undefined) return true;
  const setContext = def.context || "always";
  if (setContext === "always") return true;
  return setContext === activeContext;
}

/** Set-bonus scenario options for the optimize panel: "general", offered as
 * "None" because that is what it does — count no conditional bonus at all —
 * plus one entry per distinct conditional context among known sets, labeled
 * with that context's `appliesIn` text. */
function optimizeContextOptions() {
  const options = [{ value: "general", label: "None" }];
  const seen = new Set();
  for (const def of Object.values(SET_BONUS_DEFS)) {
    const ctx = def.context || "always";
    if (ctx === "always" || seen.has(ctx)) continue;
    seen.add(ctx);
    options.push({ value: ctx, label: def.appliesIn });
  }
  return options;
}

/**
 * Given selected items (loadout values, nulls filtered out already), compute
 * the active cumulative bonus per stat key, aggregated across every set with
 * 2+ selected pieces. Returns { statKey: totalBonusValue }.
 *
 * `activeContext` filters which sets contribute — see setBonusAppliesInContext.
 * Defaults to null (count everything) so existing raw-ledger callers are
 * unaffected; the optimizer passes the user's chosen scenario.
 */
function computeActiveSetBonusStats(selectedItems, activeContext = null) {
  const countsBySet = {};
  for (const item of selectedItems) {
    if (item.setId) countsBySet[item.setId] = (countsBySet[item.setId] || 0) + 1;
  }

  const totals = {};
  for (const [setId, count] of Object.entries(countsBySet)) {
    const def = SET_BONUS_DEFS[setId];
    if (!def) continue;
    if (!setBonusAppliesInContext(def, activeContext)) continue;
    for (const tier of def.tiers) {
      if (count >= tier.pieces) {
        for (const [statKey, value] of Object.entries(tier.bonuses)) {
          totals[statKey] = (totals[statKey] || 0) + value;
        }
      }
    }
  }
  return totals;
}

/**
 * Human-readable notes for the "Set pieces" panel: one entry per set with
 * 2+ selected pieces, whether we know its bonus table or not.
 */
function buildSetNotes(selectedItems, knownSetSizes) {
  const countsBySet = {};
  for (const item of selectedItems) {
    if (item.setId) countsBySet[item.setId] = (countsBySet[item.setId] || 0) + 1;
  }

  const notes = [];
  for (const [setId, count] of Object.entries(countsBySet)) {
    if (count < 2) continue;
    const def = SET_BONUS_DEFS[setId];

    if (def) {
      const activeTiers = def.tiers.filter((t) => count >= t.pieces);
      const nextTier = def.tiers.find((t) => count < t.pieces);

      // Sum bonuses by stat across all active tiers — cumulative, not one
      // line per tier — so e.g. 3 pieces shows a single "+10.0%" line, not
      // "+4.0%, +6.0%" for the same stat.
      const activeTotals = {};
      for (const tier of activeTiers) {
        for (const [statKey, value] of Object.entries(tier.bonuses)) {
          activeTotals[statKey] = (activeTotals[statKey] || 0) + value;
        }
      }
      const activeText = Object.keys(activeTotals).length
        ? Object.entries(activeTotals)
            .map(([statKey, value]) => `${STAT_LABELS[statKey] || statKey} +${(value * 100).toFixed(1)}%`)
            .join(", ")
        : "none yet";
      const contextSuffix =
        def.context && def.context !== "always" ? ` — applies in ${def.appliesIn}` : "";
      let text = `${def.name} (${count}/${def.totalPieces}): ${activeText}${contextSuffix}`;
      if (nextTier) {
        const nextText = Object.entries(nextTier.bonuses)
          .map(([statKey, value]) => `${STAT_LABELS[statKey] || statKey} +${(value * 100).toFixed(1)}%`)
          .join(", ");
        text += ` — ${nextTier.pieces} pieces unlocks: ${nextText}`;
      }
      notes.push(text);
    } else {
      const total = (knownSetSizes && knownSetSizes[setId]) || count;
      notes.push(
        `Set '${setId}': ${count} of ${total} owned piece types selected — bonus not yet documented for this set.`
      );
    }
  }
  return notes;
}
