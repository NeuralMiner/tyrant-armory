/**
 * The Auto-optimize Everything page.
 *
 * All the state, persistence and scoring lives in app.js, which this page
 * loads first; everything it needs from there comes through window.TyrantArmory
 * and nothing else. What lives HERE is the page's own configuration — which
 * hero is built with which preset, in what order — plus the UI over it.
 *
 * That configuration is keyed by hero NAME, not by hero id. Ids are assigned
 * per export and change from one import to the next (the same Bloodreaver Kael
 * is a different uuid in every CSV in csv-exports/), so an id-keyed setup would
 * silently reset itself every time the player re-imported. Names are what a
 * player actually recognises and what stays put.
 */
(() => {
  "use strict";

  const {
    state,
    BATCH_SKIP_PRESET,
    TROOP_PRIORITY_PRESETS,
    PRESET_SCENARIO,
    resolveTroopPresetKey,
    ownerLabel,
    presetWeightsForInventory,
    optimizeHeroesInOrder,
    loadoutSnapshot,
    setMaxLevelScoring,
    applyCsvText,
    readFileAsText,
    showToast,
    savePanelOpen,
    loadPanelOpen,
    applyPanelOpenState,
  } = window.TyrantArmory;

  const PLAN_STORAGE_KEY = "tyrant-batch-optimize-plan-v1";
  const SHOW_EXPLAINER_STORAGE_KEY = "tyrant-batch-show-explainer-v1";

  /** The recommended plan: every hero this game has, in the order they should
   * get first pick of the gear, with the preset and scenario each is built for.
   *
   * Damage-dealing PvP heroes first — they are what a march is actually judged
   * on — then the gatherers, who care about a disjoint set of stats and so
   * mostly aren't competing for the same pieces anyway. The two at the bottom
   * are built for nothing: they hold no march worth gearing, and having them
   * last with no preset is what hands their gear to everyone above.
   *
   * A hero not listed here (a new one, or a rename) defaults to Mixed / Player
   * Combat at the bottom of the list rather than to skip — an unrecognised hero
   * getting optimized last is harmless, whereas defaulting them to skip would
   * strip gear off a hero the player never said anything about. */
  const RECOMMENDED_PLAN = [
    { name: "Bloodreaver Kael", preset: "cavalry", scenario: "playerCombat" },
    { name: "Deadeye Kestrel", preset: "archers", scenario: "playerCombat" },
    { name: "Bastion Hadrian", preset: "infantry", scenario: "playerCombat" },
    { name: "Battlehorn Cassian", preset: "mixed", scenario: "playerCombat" },
    { name: "Ironheart Roderic", preset: "infantry", scenario: "playerCombat" },
    { name: "Dawnbringer Valeria", preset: "cavalry", scenario: "playerCombat" },
    { name: "Forgefist Durgan", preset: "infantry", scenario: "playerCombat" },
    { name: "Ironwall Theron", preset: "infantry", scenario: "playerCombat" },
    { name: "Leafsong Aelindra", preset: "gathering", scenario: "gathering" },
    { name: "Gatherer Elena", preset: "gathering", scenario: "gathering" },
    { name: "Goldvein Thorek", preset: "gathering", scenario: "gathering" },
    { name: "Warlord Marcus", preset: "gathering", scenario: "gathering" },
    { name: "Swiftarrow Lyris", preset: "gathering", scenario: "gathering" },
    { name: "Moonveil Seraphina", preset: BATCH_SKIP_PRESET, scenario: "general" },
    { name: "Stonewall Borin", preset: BATCH_SKIP_PRESET, scenario: "general" },
  ];

  /** What an unlisted hero is built with — see RECOMMENDED_PLAN. */
  const FALLBACK_ENTRY = { preset: "mixed", scenario: "playerCombat" };

  const explainerEl = document.getElementById("batch-explainer");
  const explainerToggleEl = document.getElementById("batch-explainer-toggle");
  const explainerBodyEl = document.getElementById("batch-explainer-body");
  const explainerBasisEl = document.getElementById("batch-basis-note");
  const maxLevelEl = document.getElementById("batch-max-level");
  const emptyEl = document.getElementById("batch-empty");
  const configEl = document.getElementById("batch-config");
  const heroListEl = document.getElementById("batch-hero-list");
  const resetBtnEl = document.getElementById("batch-reset-btn");
  const runBtnEl = document.getElementById("batch-run-btn");
  const runHintEl = document.getElementById("batch-run-hint");
  const progressEl = document.getElementById("batch-progress");
  const resultsEl = document.getElementById("batch-results");
  const loadCsvBtnEl = document.getElementById("batch-load-csv-btn");
  const loadCsvInputEl = document.getElementById("batch-load-csv-input");
  const pasteBtnEl = document.getElementById("batch-paste-csv-btn");
  const pasteOverlayEl = document.getElementById("batch-paste-overlay");
  const pasteCloseEl = document.getElementById("batch-paste-close");
  const pasteTextareaEl = document.getElementById("batch-paste-textarea");
  const pasteSubmitEl = document.getElementById("batch-paste-submit");

  /** name -> {preset, scenario}, and the order those names run in. Both are
   * the player's, both persist, and both cover heroes who aren't in the
   * current import — a hero missing from one export shouldn't lose the
   * settings they had in the last one. */
  let savedConfig = {};
  let savedOrder = [];

  /** True while a run is in flight — the run mutates every loadout in the plan
   * and re-entering it would interleave two passes over the same gear. */
  let running = false;

  /** Whether the player has asked for a run on this visit.
   *
   * A run strips every hero in the plan and re-equips them from scratch, which
   * is not something to do to somebody's account because they opened a page —
   * so nothing happens until the button is pressed. After that the page keeps
   * itself true: every input here changes who ends up in which gear, so once
   * there are results on screen, moving one of them rebuilds rather than leaves
   * a roster that no longer matches the configuration above it.
   *
   * Deliberately not persisted. A reload is a fresh visit, and the promise that
   * arriving on this page touches nothing has to hold every time, not just the
   * first. */
  let hasRun = false;

  /** A change arrived while a run was in flight, so the results it is about to
   * print are already out of date. Nothing can be done until it finishes —
   * two passes over the same gear can't be interleaved — so the change is
   * remembered here and the run happens again as soon as the first is done. */
  let rerunQueued = false;

  /** Owner ids whose gear snapshot is expanded. Every change on this page
   * re-runs and reprints the results, and a player who opened two heroes to
   * compare their gear is watching exactly those two — reprinting them closed
   * would collapse the thing the change was made to look at. Kept by owner id
   * rather than by row, since the order is one of the things that moves. */
  const openSnapshots = new Set();

  /** Pending debounce timer — see scheduleRun. */
  let runTimer = null;

  /** How long a change waits before the roster is rebuilt. Long enough that
   * walking a hero up four places with the arrows is one run rather than four,
   * short enough that a single dropdown change feels like it answered. */
  const RUN_DEBOUNCE_MS = 350;

  /** The hero's name without the "— March" / "— Dens" suffix the import adds
   * when a hero's march and instanced loadouts differ (see csv-import.js).
   *
   * `baseName` is carried on every imported hero; the fallback is for equipment
   * saved before this page existed, and for the live sync server's own hero
   * shape. It only strips a suffix from a hero whose id says they're a split
   * one, so a hero genuinely named with a dash keeps their whole name. */
  function baseHeroName(hero) {
    if (hero.baseName) return hero.baseName;
    if (!/::(march|instanced)$/.test(hero.id)) return hero.name;
    return hero.name.replace(/ — [^—]*$/, "");
  }

  /** The heroes this page will offer, in the player's configured order.
   *
   * Instanced pseudo-owners are dropped outright: those are dungeon sets, not
   * marches, and nothing on this page should touch them. A hero whose two
   * loadouts agree has no suffixed ids at all and comes through as themselves.
   */
  function heroRows() {
    const heroes = state.heroes.filter((h) => !h.id.endsWith("::instanced"));
    const recommendedIndex = new Map(RECOMMENDED_PLAN.map((e, i) => [e.name, i]));
    const savedIndex = new Map(savedOrder.map((name, i) => [name, i]));

    const rows = heroes.map((hero, i) => {
      const name = baseHeroName(hero);
      const entry = savedConfig[name]
        || RECOMMENDED_PLAN.find((e) => e.name === name)
        || FALLBACK_ENTRY;
      return {
        ownerId: hero.id,
        name,
        label: hero.name,
        preset: entry.preset,
        scenario: entry.scenario,
        // Sort key, most significant first: where the player put them, then
        // where the recommended plan puts them, then the import's own order.
        // The offsets keep the three tiers from interleaving.
        sortKey: [
          savedIndex.has(name) ? savedIndex.get(name) : Infinity,
          recommendedIndex.has(name) ? recommendedIndex.get(name) : Infinity,
          i,
        ],
      };
    });

    rows.sort((a, b) => {
      for (let i = 0; i < a.sortKey.length; i++) {
        if (a.sortKey[i] !== b.sortKey[i]) return a.sortKey[i] - b.sortKey[i];
      }
      return 0;
    });
    return rows;
  }

  function savePlan() {
    try {
      localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify({ order: savedOrder, config: savedConfig }));
    } catch (err) {
      console.warn("Couldn't save the auto-optimize-everything plan:", err);
    }
  }

  /** Read the saved plan back, dropping anything a hand-edited or stale file
   * could have put there: unknown preset keys, unknown scenarios, non-strings.
   * A dropped field falls back to the recommended plan rather than to nothing,
   * so a partly-corrupt file still leaves a usable page. */
  function loadSavedPlan() {
    let raw = null;
    try {
      raw = JSON.parse(localStorage.getItem(PLAN_STORAGE_KEY) || "null");
    } catch (err) {
      console.warn("Couldn't parse the saved auto-optimize-everything plan:", err);
    }
    if (!raw || typeof raw !== "object") return;

    const scenarios = new Set(optimizeContextOptions().map((o) => o.value));
    savedOrder = Array.isArray(raw.order) ? raw.order.filter((n) => typeof n === "string") : [];
    savedConfig = {};
    for (const [name, entry] of Object.entries(raw.config || {})) {
      if (!entry || typeof entry !== "object") continue;
      const preset = entry.preset === BATCH_SKIP_PRESET
        ? entry.preset
        : resolveTroopPresetKey(entry.preset);
      if (!preset) continue;
      savedConfig[name] = {
        preset,
        scenario: scenarios.has(entry.scenario) ? entry.scenario : "general",
      };
    }
  }

  /** Write the on-screen list back to the saved plan. Called after every edit,
   * so there is no separate save step and no way for the two to disagree. */
  function commitRows(rows) {
    savedOrder = rows.map((r) => r.name);
    for (const row of rows) {
      savedConfig[row.name] = { preset: row.preset, scenario: row.scenario };
    }
    savePlan();
  }

  function presetLabel(key) {
    if (key === BATCH_SKIP_PRESET) return "Don't optimize";
    const preset = TROOP_PRIORITY_PRESETS[key];
    if (!preset) return key;
    // Same marker the builder's own dropdown uses, and for the same reason:
    // this preset will be built with the player's saved weights, not ours.
    return state.customTroopPresets[key] ? `${preset.label} (custom)` : preset.label;
  }

  function makeSelect(className, label, options, value, onChange) {
    const select = document.createElement("select");
    select.className = className;
    select.setAttribute("aria-label", label);
    // A run reads the whole list once and then works from that snapshot, so an
    // edit made mid-run would leave the config on screen disagreeing with the
    // results printed under it.
    select.disabled = running;
    for (const opt of options) {
      const el = document.createElement("option");
      el.value = opt.value;
      el.textContent = opt.label;
      select.appendChild(el);
    }
    select.value = value;
    // A saved scenario can name a context this build no longer defines, which
    // would leave the select blank over a config that says otherwise.
    if (select.selectedIndex < 0) select.selectedIndex = 0;
    select.addEventListener("change", () => onChange(select.value));
    return select;
  }

  /** The preset dropdown's order, spelled out to match the builder's own —
   * TROOP_PRIORITY_PRESETS is keyed alphabetically, which puts Archers/Cavalry
   * above Cavalry and reads as noise. Anything the file gains later still
   * shows up, appended, rather than silently going missing. */
  const PRESET_ORDER = [
    "mixed", "infantry", "archers", "cavalry",
    "infantryCavalry", "infantryArchers", "archersCavalry", "gathering",
  ];

  const presetOptions = () => {
    const keys = [
      ...PRESET_ORDER.filter((k) => k in TROOP_PRIORITY_PRESETS),
      ...Object.keys(TROOP_PRIORITY_PRESETS).filter((k) => !PRESET_ORDER.includes(k)),
    ];
    return [
      ...keys.map((key) => ({ value: key, label: presetLabel(key) })),
      { value: BATCH_SKIP_PRESET, label: presetLabel(BATCH_SKIP_PRESET) },
    ];
  };

  /** The column header over the list: what the two dropdowns on every row
   * below actually decide. Side by side they read as two ways of saying the
   * same thing — one picks the stats a hero is scored on, the other picks
   * which conditional set bonuses count toward that score — so each is named
   * and explained where it stands.
   *
   * Built as a row of the same list so the columns line up with the real ones
   * at every width, and hidden from assistive tech: every control below
   * carries its own label, and a header repeating them is noise there. */
  function renderHeaderRow() {
    const li = document.createElement("li");
    li.className = "batch-hero-row batch-hero-head";
    li.setAttribute("aria-hidden", "true");

    const rank = document.createElement("span");
    rank.className = "batch-hero-rank";
    li.appendChild(rank);

    const name = document.createElement("span");
    name.className = "batch-hero-name batch-head-name";
    name.textContent = "Hero";
    li.appendChild(name);

    const controls = document.createElement("div");
    controls.className = "batch-hero-controls";
    controls.appendChild(makeHeadColumn("Preset", "the stats they're built for"));
    controls.appendChild(makeHeadColumn("Set bonuses", "which conditional ones count"));
    li.appendChild(controls);

    // Invisible copies of the real buttons rather than a guessed width: the
    // spacer has to match whatever they measure at this font.
    const moves = document.createElement("div");
    moves.className = "batch-hero-moves batch-head-moves";
    for (const glyph of ["▲", "▼"]) {
      const ghost = document.createElement("button");
      ghost.type = "button";
      ghost.className = "batch-move-btn";
      ghost.textContent = glyph;
      ghost.disabled = true;
      ghost.tabIndex = -1;
      moves.appendChild(ghost);
    }
    li.appendChild(moves);

    heroListEl.appendChild(li);
  }

  function makeHeadColumn(label, note) {
    const col = document.createElement("div");
    col.className = "batch-head-col";

    const title = document.createElement("span");
    title.className = "batch-head-label";
    title.textContent = label;
    col.appendChild(title);

    const hint = document.createElement("span");
    hint.className = "batch-head-note";
    hint.textContent = note;
    col.appendChild(hint);

    return col;
  }

  function renderHeroList() {
    const rows = heroRows();
    heroListEl.innerHTML = "";
    renderHeaderRow();

    rows.forEach((row, index) => {
      const li = document.createElement("li");
      li.className = "batch-hero-row";
      if (row.preset === BATCH_SKIP_PRESET) li.classList.add("batch-hero-row-skipped");

      const rank = document.createElement("span");
      rank.className = "batch-hero-rank";
      rank.textContent = index + 1;
      li.appendChild(rank);

      const name = document.createElement("span");
      name.className = "batch-hero-name";
      name.textContent = row.label;
      li.appendChild(name);

      const controls = document.createElement("div");
      controls.className = "batch-hero-controls";

      controls.appendChild(makeSelect(
        "optimize-context-select batch-hero-select",
        `Preset for ${row.label}`, presetOptions(), row.preset,
        (value) => {
          row.preset = value;
          // A preset that implies a scenario points this row's scenario at it,
          // the same rule the builder follows (see PRESET_SCENARIO): Gathering
          // scored under "General" ignores the Prospector's Kit, the one set
          // that exists for the job the preset is for. Only if that scenario is
          // on offer — the list is built from the sets this player's data knows
          // about. There is no undo half here, unlike the builder's: the
          // scenario next to it is a dropdown the player can put back in one
          // click, so pointing it at Gathering is the whole rule.
          const implied = PRESET_SCENARIO[value];
          if (implied && optimizeContextOptions().some((o) => o.value === implied)) {
            row.scenario = implied;
          }
          commitRows(rows);
          renderHeroList();
          scheduleRun();
        },
      ));
      controls.appendChild(makeSelect(
        "optimize-context-select batch-hero-select",
        `Set bonuses for ${row.label}`, optimizeContextOptions(), row.scenario,
        (value) => {
          row.scenario = value;
          commitRows(rows);
          scheduleRun();
        },
      ));
      li.appendChild(controls);

      const moves = document.createElement("div");
      moves.className = "batch-hero-moves";
      moves.appendChild(makeMoveButton("▲", `Move ${row.label} up`, index === 0, () => {
        rows.splice(index - 1, 0, rows.splice(index, 1)[0]);
        commitRows(rows);
        renderHeroList();
        scheduleRun();
      }));
      moves.appendChild(makeMoveButton("▼", `Move ${row.label} down`, index === rows.length - 1, () => {
        rows.splice(index + 1, 0, rows.splice(index, 1)[0]);
        commitRows(rows);
        renderHeroList();
        scheduleRun();
      }));
      li.appendChild(moves);

      heroListEl.appendChild(li);
    });

    return rows;
  }

  /** A preset the loaded inventory has no stats for can't score anything, so a
   * hero on it would come out of a run empty. Said once, when the data lands —
   * not on every dropdown change, which is the other time the list repaints. */
  function warnUnusablePresets(rows) {
    const unusable = [...new Set(
      rows.filter((r) => r.preset !== BATCH_SKIP_PRESET
        && !Object.keys(presetWeightsForInventory(r.preset)).length)
        .map((r) => presetLabel(r.preset)),
    )];
    if (!unusable.length) return;
    showToast(`No stat in this inventory is one the ${unusable.join(" or ")} `
      + `preset weights — heroes on ${unusable.length === 1 ? "it" : "them"} will be left empty.`);
  }

  function makeMoveButton(glyph, title, disabled, onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "batch-move-btn";
    btn.textContent = glyph;
    btn.title = title;
    btn.setAttribute("aria-label", title);
    btn.disabled = disabled || running;
    btn.addEventListener("click", onClick);
    return btn;
  }

  /** The checkbox and the sentence under it, both off state.maxLevelScoring —
   * this is the builder's setting, not a second one, so it has to be re-read
   * rather than remembered locally. */
  function renderBasisNote() {
    maxLevelEl.checked = state.maxLevelScoring;
    explainerBasisEl.textContent = state.maxLevelScoring
      ? "Every piece is scored at its level cap — Attack/Defence/Health projected "
        + "to max, affixes as rolled — so the run builds toward what your gear "
        + "becomes rather than what it reads today. This is the builder's own "
        + "setting: turning it off here turns it off there too."
      : "Gear is scored as it is right now, at the level each piece is on. Turn "
        + "this on to build for what every piece becomes once it's fully "
        + "enhanced. This is the builder's own setting: turning it on here turns "
        + "it on there too.";
  }

  /** One hero's row in the results, as a collapsible over the gear the run
   * just gave them. Closed by default — the panel's job is still the summary,
   * and fifteen open snapshots would bury it — and built only when the row is
   * created, since the loadout it reads can't change while the results stand.
   *
   * The name and note passed in are the same elements the plain rows use, so
   * an expanded row and a skipped one read as the same list. */
  function makeSnapshot(ownerId, label, name, note) {
    const details = document.createElement("details");
    details.className = "batch-snapshot";
    details.open = openSnapshots.has(ownerId);
    details.addEventListener("toggle", () => {
      if (details.open) openSnapshots.add(ownerId);
      else openSnapshots.delete(ownerId);
    });

    const summary = document.createElement("summary");
    summary.className = "batch-results-summary";

    const head = document.createElement("span");
    head.className = "batch-results-head";
    const caret = document.createElement("span");
    caret.className = "batch-snapshot-caret";
    caret.textContent = "▸";
    caret.setAttribute("aria-hidden", "true");
    head.appendChild(caret);
    head.appendChild(name);
    summary.appendChild(head);
    summary.appendChild(note);
    details.appendChild(summary);

    const body = document.createElement("div");
    body.className = "batch-snapshot-body";

    const grid = document.createElement("div");
    grid.className = "batch-snapshot-grid";
    for (const entry of loadoutSnapshot(ownerId)) grid.appendChild(makeSnapshotSlot(entry));
    body.appendChild(grid);

    // A new tab rather than this one: the results panel is a list you read
    // top to bottom, and following a hero out of it would cost the run's
    // summary — it isn't recomputed on the way back.
    const link = document.createElement("a");
    link.className = "batch-snapshot-link";
    link.href = `index.html?hero=${encodeURIComponent(ownerId)}`;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = `Open ${label} in the Loadout Builder ↗`;
    body.appendChild(link);

    details.appendChild(body);
    return details;
  }

  /** One slot of a snapshot, drawn on the builder's own slot card — same
   * classes, same markup, so a hero's gear reads here exactly as it does on
   * the loadout screen. Everything that makes that card a control is left off:
   * there is no picker to open, no slot to lock, and nothing to click.
   *
   * loadoutSnapshot has already spelled the meta line and the stats out, so a
   * max-level run's cards read at max level like everything else does. */
  function makeSnapshotSlot({ slot, item }) {
    const card = document.createElement("div");
    card.className = "slot-card slot-card-static"
      + (item ? ` filled rarity-${item.rarity}` : "");

    const head = document.createElement("div");
    head.className = "slot-card-head";
    const label = document.createElement("div");
    label.className = "slot-label";
    label.textContent = slot;
    head.appendChild(label);
    card.appendChild(head);

    if (!item) {
      const empty = document.createElement("div");
      empty.className = "slot-empty-name";
      empty.textContent = "Empty";
      card.appendChild(empty);
      return card;
    }

    const name = document.createElement("div");
    name.className = "slot-item-name";
    name.textContent = item.name;
    card.appendChild(name);

    const meta = document.createElement("div");
    meta.className = "slot-meta";
    meta.innerHTML = item.metaHtml;
    card.appendChild(meta);

    if (item.statLines.length) {
      const stats = document.createElement("div");
      stats.className = "slot-stats";
      stats.textContent = item.statLines.join(" · ");
      card.appendChild(stats);
    }

    return card;
  }

  function renderResults(results) {
    resultsEl.innerHTML = "";
    resultsEl.hidden = false;

    // A hero the current data doesn't have can't be reopened, and ids are
    // per-import — so what this run didn't print is forgotten rather than kept
    // against a hero who may never come back.
    const present = new Set(results.filter((r) => r.status === "optimized").map((r) => r.ownerId));
    for (const id of openSnapshots) {
      if (!present.has(id)) openSnapshots.delete(id);
    }

    const heading = document.createElement("h3");
    heading.className = "batch-results-heading";
    const built = results.filter((r) => r.status === "optimized");
    heading.textContent = `Optimized ${built.length} hero${built.length === 1 ? "" : "es"}`;
    resultsEl.appendChild(heading);

    // A hero set to Don't optimize was excluded on purpose, so there is
    // nothing to report about them here — the configuration above already
    // shows who they are. A hero left empty by an unusable preset is NOT the
    // same thing and stays listed: that one is a result the player didn't ask
    // for and would otherwise have no sign of.
    const listed = results.filter((r) => r.status !== "skipped");

    const list = document.createElement("ul");
    list.className = "batch-results-list";
    for (const result of listed) {
      const li = document.createElement("li");
      li.className = "batch-results-row";

      const label = ownerLabel(result.ownerId);
      const name = document.createElement("span");
      name.className = "batch-results-name";
      name.textContent = label;

      const note = document.createElement("span");
      note.className = "batch-results-note";
      if (result.status === "no-weights") {
        li.classList.add("batch-results-row-skipped");
        note.textContent = `left empty — this inventory has no stat the ${presetLabel(result.preset)} preset weights`;
      } else {
        // Worth saying which one you got, same as the single-hero run: an
        // exhausted search is a proof, a budget-capped one is the best found.
        note.textContent = `${result.equipped} item${result.equipped === 1 ? "" : "s"}`
          + ` · ${presetLabel(result.preset)}`
          + (result.exhaustive ? "" : " · best found, not provably the best");
      }

      // Only a hero who was actually built has gear to show. One left empty by
      // an unusable preset is named and dimmed instead: a collapsible over six
      // empty slots is a click that tells you what the note already did.
      if (result.status === "optimized") {
        li.classList.add("batch-results-row-expandable");
        li.appendChild(makeSnapshot(result.ownerId, label, name, note));
      } else {
        li.appendChild(name);
        li.appendChild(note);
      }
      list.appendChild(li);
    }
    resultsEl.appendChild(list);

    const footer = document.createElement("p");
    footer.className = "batch-results-footer";
    footer.innerHTML = 'Open the <a href="index.html">Loadout Builder</a> to see any hero\'s new loadout, totals and upgrade plan.';
    resultsEl.appendChild(footer);
  }

  /** Rebuild the whole roster, after whatever asked for it settles.
   *
   * Every input this page has — the presets, the set bonuses, the order, the
   * scoring basis — changes who ends up in which gear, so there is no state of
   * this page where the last results are still true after one of them moves.
   * Which is why a change reruns rather than staling: what's on screen is the
   * roster, not a report of one.
   *
   * Only once the player has asked for a first run, though (see hasRun) — every
   * caller of this is a change to the configuration, and changing a dropdown on
   * a page you are still reading must not be what re-equips your account. */
  function scheduleRun() {
    if (state.isSampleData || !hasRun) return;
    clearTimeout(runTimer);
    runTimer = setTimeout(() => { void runOptimize(); }, RUN_DEBOUNCE_MS);
  }

  /** The button, and the line under it that says what pressing it commits to.
   * Both change once a run has happened: the warning has been acted on, and
   * from then on the button is a way to redo the pass rather than the only way
   * to start one. */
  function renderRunControls() {
    runBtnEl.disabled = running;
    runBtnEl.textContent = hasRun ? "Optimize everything again" : "Optimize everything";
    runHintEl.textContent = hasRun
      ? "Changing a preset, its set bonuses or the order now rebuilds the roster "
        + "on the spot — this button redoes the whole pass."
      : "Nothing is equipped until you run this. Once you have, changing a "
        + "preset, its set bonuses or the order rebuilds the roster on the spot.";
  }

  async function runOptimize() {
    if (running) {
      rerunQueued = true;
      return;
    }
    const rows = heroRows();
    if (!rows.length) return;

    running = true;
    hasRun = true;
    resetBtnEl.disabled = true;
    // Half the roster scored at max level and half at today's is not a basis
    // anyone asked for, so the toggle is inert until the pass is done.
    maxLevelEl.disabled = true;
    resultsEl.hidden = true;
    progressEl.hidden = false;
    renderRunControls();
    renderHeroList(); // repaint so the move buttons go inert too

    const plan = rows.map((r) => ({ ownerId: r.ownerId, preset: r.preset, scenario: r.scenario }));
    try {
      const results = await optimizeHeroesInOrder(plan, (done, total, label) => {
        progressEl.textContent = `Optimizing ${label} — ${done + 1} of ${total}…`;
      });
      renderResults(results);
    } catch (err) {
      console.error(err);
      showToast(`The run stopped early — ${err.message}. Any hero it had already reached is saved.`);
    } finally {
      running = false;
      resetBtnEl.disabled = false;
      maxLevelEl.disabled = false;
      progressEl.hidden = true;
      renderRunControls();
      renderHeroList();
      // Something moved while that was running, so what it just printed is
      // already stale — go again rather than leave the page showing a roster
      // built to a configuration the player has since changed.
      if (rerunQueued) {
        rerunQueued = false;
        scheduleRun();
      }
    }
  }

  function handleReset() {
    savedOrder = [];
    savedConfig = {};
    savePlan();
    renderHeroList();
    scheduleRun();
    showToast("Order and presets reset to the recommended plan.");
  }

  /** Repaint the whole page for whatever data is now loaded — which of the two
   * sections is showing depends on it, so a CSV import has to come back here. */
  function render() {
    const hasImport = !state.isSampleData;
    emptyEl.hidden = hasImport;
    configEl.hidden = !hasImport;
    renderRunControls();
    renderBasisNote();
    if (hasImport) warnUnusablePresets(renderHeroList());
  }

  function openPasteModal() {
    pasteTextareaEl.value = "";
    pasteOverlayEl.hidden = false;
    pasteTextareaEl.focus();
  }

  function closePasteModal() {
    pasteOverlayEl.hidden = true;
  }

  loadCsvBtnEl.addEventListener("click", () => loadCsvInputEl.click());
  loadCsvInputEl.addEventListener("change", async () => {
    const file = loadCsvInputEl.files[0];
    loadCsvInputEl.value = "";
    if (!file) return;
    let text;
    try {
      text = await readFileAsText(file);
    } catch (err) {
      showToast(err.message);
      return;
    }
    if (applyCsvText(text)) render();
  });

  pasteBtnEl.addEventListener("click", openPasteModal);
  pasteCloseEl.addEventListener("click", closePasteModal);
  pasteOverlayEl.addEventListener("click", (e) => {
    if (e.target === pasteOverlayEl) closePasteModal();
  });
  pasteSubmitEl.addEventListener("click", () => {
    const text = pasteTextareaEl.value.trim();
    if (!text) {
      showToast("Paste the CSV content first.");
      return;
    }
    if (applyCsvText(text)) {
      closePasteModal();
      render();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !pasteOverlayEl.hidden) closePasteModal();
  });

  maxLevelEl.addEventListener("change", () => {
    // Which basis every piece is scored on is as much a part of the answer as
    // the presets are, so moving it rebuilds the roster like they do.
    setMaxLevelScoring(maxLevelEl.checked);
    renderBasisNote();
    scheduleRun();
  });

  resetBtnEl.addEventListener("click", handleReset);

  // Straight to the run, with none of scheduleRun's debounce: that exists to
  // fold a burst of dropdown changes into one pass, and a button press is not a
  // burst — waiting a third of a second on it just reads as a dead button.
  runBtnEl.addEventListener("click", () => { void runOptimize(); });

  // The rules of the run, not the run itself: worth reading once, and in the
  // way on every visit after that. It opens on a first visit so the page still
  // explains itself, and stays however it was left from then on.
  let explainerOpen = loadPanelOpen(SHOW_EXPLAINER_STORAGE_KEY, true);
  applyPanelOpenState(explainerEl, explainerToggleEl, explainerBodyEl, explainerOpen);
  explainerToggleEl.addEventListener("click", () => {
    explainerOpen = !explainerOpen;
    savePanelOpen(SHOW_EXPLAINER_STORAGE_KEY, explainerOpen);
    applyPanelOpenState(explainerEl, explainerToggleEl, explainerBodyEl, explainerOpen);
  });

  loadSavedPlan();
  render();
})();
