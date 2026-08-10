/**
 * Known equipment set bonuses, read directly off in-game tooltips (2026-08).
 * Bonuses are CUMULATIVE across tiers — e.g. Prospector's Kit at 3 pieces
 * grants the 2-piece bonus AND the 3-piece bonus added together (4% + 6% =
 * 10% Gather Speed), not just the highest tier alone.
 *
 * Any setId NOT listed here falls back to an "unknown bonus" note in app.js —
 * this table only covers sets a guild member has actually screenshotted.
 */
const SET_BONUS_DEFS = {
  beast: {
    name: "Beastlord's Hunt",
    appliesIn: "Monster Dens",
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
 * Given selected items (loadout values, nulls filtered out already), compute
 * the active cumulative bonus per stat key, aggregated across every set with
 * 2+ selected pieces. Returns { statKey: totalBonusValue }.
 */
function computeActiveSetBonusStats(selectedItems) {
  const countsBySet = {};
  for (const item of selectedItems) {
    if (item.setId) countsBySet[item.setId] = (countsBySet[item.setId] || 0) + 1;
  }

  const totals = {};
  for (const [setId, count] of Object.entries(countsBySet)) {
    const def = SET_BONUS_DEFS[setId];
    if (!def) continue;
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
      let text = `${def.name} (${count}/${def.totalPieces}): ${activeText}`;
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
