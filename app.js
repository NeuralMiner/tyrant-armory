(() => {
  "use strict";

  const NO_HERO_OWNER = "";
  const LOADOUTS_STORAGE_KEY = "tyrant-equipment-loadouts-v1";
  const EQUIPMENT_STORAGE_KEY = "tyrant-equipment-data-v1";
  const LOCKED_SLOTS_STORAGE_KEY = "tyrant-equipment-locked-slots-v1";

  const state = {
    slotOrder: SLOT_ORDER,
    itemsBySlot: {},
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
  };

  let pendingLiveEquipPreview = null; // {heroId, loadout} once previewed against the sync server, until confirmed or invalidated

  function activeLoadout() {
    return state.loadoutsByOwner[state.activeOwner];
  }

  function heroName(heroId) {
    const hero = state.heroes.find((h) => h.id === heroId);
    return hero ? hero.name : "another hero";
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
        equipment: Object.values(state.itemsBySlot).flat(),
        knownSetSizes: state.knownSetSizes,
      }));
    } catch (err) {
      console.warn("Couldn't save equipment data to localStorage:", err);
    }
  }

  function loadSavedEquipmentData() {
    try {
      const raw = localStorage.getItem(EQUIPMENT_STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (err) {
      console.warn("Couldn't parse saved equipment data:", err);
      return null;
    }
  }

  function applyEquipmentData(data, { isSample }) {
    // Any pending preview belongs to whatever loadout/hero was active in the
    // PREVIOUS session — new data (including a fresh live sync) invalidates it.
    invalidatePendingLiveEquip();
    state.heroes = data.heroes;
    state.itemsBySlot = groupBySlot(data.equipment);
    state.availableStats = availableStats(data.equipment);
    state.availableRarities = availableRarities(data.equipment);
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

    if (!(state.activeOwner in state.loadoutsByOwner)) state.activeOwner = NO_HERO_OWNER;
    ensureOwnerLoadout(state.activeOwner);

    renderHeroSelect();
    renderOptimizeWeightList();
    updateOptimizeWeightBadge();
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
    if (data.loadoutsByOwner) {
      state.loadoutsByOwner = sanitizeLoadouts(data.loadoutsByOwner);
      saveLoadouts();
      if (!(state.activeOwner in state.loadoutsByOwner)) state.activeOwner = NO_HERO_OWNER;
      ensureOwnerLoadout(state.activeOwner);
      invalidatePendingLiveEquip();
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
      equipment: Object.values(state.itemsBySlot).flat(),
      knownSetSizes: state.knownSetSizes,
      loadoutsByOwner: state.loadoutsByOwner,
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
  const setNotesWrapEl = document.getElementById("set-notes-wrap");
  const setNotesEl = document.getElementById("set-notes");
  const heroSelectEl = document.getElementById("hero-select");
  const optimizeMenuBtnEl = document.getElementById("optimize-menu-btn");
  const optimizeMenuListEl = document.getElementById("optimize-menu-list");
  const optimizeWeightListEl = document.getElementById("optimize-weight-list");
  const optimizeWeightBadgeEl = document.getElementById("optimize-weight-badge");
  const optimizeClearBtnEl = document.getElementById("optimize-clear-btn");
  const optimizeRunBtnEl = document.getElementById("optimize-run-btn");
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

  function sumStats(items) {
    const totals = {};
    for (const key of Object.keys(STAT_LABELS)) totals[key] = 0;
    for (const it of items) {
      for (const key of Object.keys(STAT_LABELS)) {
        totals[key] += it.rawStats[key] || 0;
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
  function combinedStatsForLoadout(loadout) {
    const selected = selectedItemsForLoadout(loadout);
    const gearTotals = sumStats(selected);
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

  /** An item's optimize score is the weighted sum of its raw stats — a
   * single stat at weight 1 with everything else 0 behaves exactly like
   * the old single-stat optimize. */
  function weightedScore(rawStats, weights) {
    let score = 0;
    for (const [key, weight] of Object.entries(weights)) {
      if (weight) score += weight * (rawStats[key] || 0);
    }
    return score;
  }

  function bestItemForWeights(candidates, weights) {
    if (!candidates.length) return null;
    let best = candidates[0];
    let bestScore = weightedScore(best.rawStats, weights);
    for (const c of candidates) {
      const score = weightedScore(c.rawStats, weights);
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

  function totalScoreForLoadout(itemsBySlot, loadout, weights) {
    const selected = [];
    let total = 0;
    for (const slot of SLOT_ORDER) {
      const itemId = loadout[slot];
      if (!itemId) continue;
      const item = (itemsBySlot[slot] || []).find((it) => it.id === itemId);
      if (item) {
        total += weightedScore(item.rawStats, weights);
        selected.push(item);
      }
    }
    total += weightedScore(computeActiveSetBonusStats(selected), weights);
    return total;
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
          const greedyVal = greedyItem ? weightedScore(greedyItem.rawStats, weights) : 0;
          const setVal = weightedScore(setBestBySlot[slot].rawStats, weights);
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

  function openItemCompareModal(slot, itemIdA, itemIdB) {
    const itemA = itemById(slot, itemIdA);
    const itemB = itemById(slot, itemIdB);
    compareControlsEl.hidden = true;
    renderLoadoutDiff(
      `${itemA.name} (Lvl ${itemA.level})`, itemA.rawStats,
      `${itemB.name} (Lvl ${itemB.level})`, itemB.rawStats
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
        updateOptimizeWeightBadge();
      });

      row.appendChild(input);
      optimizeWeightListEl.appendChild(row);
    }
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
        meta.innerHTML = `<span class="rarity-dot"></span> ${it.rarity} · Lvl ${it.level}`;
        card.appendChild(meta);

        if (it.stats.length) {
          const stats = document.createElement("div");
          stats.className = "slot-stats";
          stats.textContent = it.stats.join(" · ");
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
      metaLine.innerHTML = `<span class="rarity-dot"></span> ${it.rarity} · Lvl ${it.level}`;
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

      if (it.stats.length) {
        const statsLine = document.createElement("div");
        statsLine.className = "picker-option-stats";
        statsLine.textContent = it.stats.join(" · ");
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

  function refreshTotals() {
    const { totals, setNotes } = computeTotals(activeLoadout());
    renderLedger(totals, setNotes);
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
    state.activeOwner = NO_HERO_OWNER;
    heroSelectEl.value = "";
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
    const loadout = pickBestPerSlotWithSetBonuses(
      state.itemsBySlot, weights, excludeIds, currentLoadout, lockedSlots
    );
    state.loadoutsByOwner[state.activeOwner] = loadout;
    saveLoadouts();
    invalidatePendingLiveEquip();
    renderSlots();
    refreshTotals();
    closeOptimizeMenu();
    const weightedNames = Object.keys(weights).filter((k) => weights[k]).map((k) => STAT_LABELS[k] || k);
    const lockedCount = lockedSlots.size;
    const lockedNote = lockedCount ? ` (${lockedCount} slot${lockedCount === 1 ? "" : "s"} left locked)` : "";
    showToast(`Auto-optimized for ${weightedNames.join(", ")}${lockedNote}.`);
  }

  function switchOwner(newOwner) {
    state.activeOwner = newOwner;
    ensureOwnerLoadout(newOwner);
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
    state.itemsBySlot = groupBySlot(initialData.equipment);
    state.availableStats = availableStats(initialData.equipment);
    state.availableRarities = availableRarities(initialData.equipment);
    state.knownSetSizes = initialData.knownSetSizes || {};
    state.isSampleData = !savedEquipment;
    state.isLive = false;
    if (sampleBannerEl) sampleBannerEl.hidden = !state.isSampleData;

    state.loadoutsByOwner = loadSavedLoadouts();
    state.lockedSlotsByOwner = loadSavedLockedSlots();
    state.activeOwner = NO_HERO_OWNER;
    ensureOwnerLoadout(state.activeOwner);

    renderHeroSelect();
    renderOptimizeWeightList();
    updateOptimizeWeightBadge();
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
      renderOptimizeWeightList();
      updateOptimizeWeightBadge();
    });
    optimizeRunBtnEl.addEventListener("click", handleOptimizeRun);
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
  }

  init();
})();
