/**
 * FFG XML Character Importer
 * Imports OggDude Character Generator XML exports into Star Wars FFG actors.
 */

const MODULE_ID = "ffg-xml-importer";
const TEMPLATE = `modules/${MODULE_ID}/templates/import-dialog.html`;

const CHARACTERISTIC_MAP = {
  BR: "Brawn",
  AG: "Agility",
  INT: "Intellect",
  CUN: "Cunning",
  WIL: "Willpower",
  PR: "Presence",
};

const SKILL_MAP = {
  ASTRO: "Astrogation",
  ATHL: "Athletics",
  BRAWL: "Brawl",
  CHARM: "Charm",
  COERC: "Coercion",
  COMP: "Computers",
  COOL: "Cool",
  COORD: "Coordination",
  CORE: "Knowledge: Core Worlds",
  DECEP: "Deception",
  DISC: "Discipline",
  EDU: "Knowledge: Education",
  GUNN: "Gunnery",
  LEAD: "Leadership",
  LTSABER: "Lightsaber",
  LORE: "Knowledge: Lore",
  MECH: "Mechanics",
  MED: "Medicine",
  MELEE: "Melee",
  NEG: "Negotiation",
  OUT: "Knowledge: Outer Rim",
  PERC: "Perception",
  PILOTPL: "Piloting: Planetary",
  PILOTSP: "Piloting: Space",
  RANGHVY: "Ranged: Heavy",
  RANGLT: "Ranged: Light",
  RESIL: "Resilience",
  SKUL: "Skulduggery",
  STEAL: "Stealth",
  SW: "Streetwise",
  SURV: "Survival",
  UND: "Knowledge: Underworld",
  VIGIL: "Vigilance",
  XEN: "Knowledge: Xenology",
  WARF: "Knowledge: Warfare",
};

/* -------------------------------------------- */
/*  XML helpers                                 */
/* -------------------------------------------- */

/** First direct child element with the given tag name (case-sensitive, XML-safe). */
function el(parent, tag) {
  if (!parent) return null;
  for (const child of parent.children) {
    if (child.tagName === tag) return child;
  }
  return null;
}

/** All direct child elements with the given tag name. */
function els(parent, tag) {
  if (!parent) return [];
  const out = [];
  for (const child of parent.children) {
    if (child.tagName === tag) out.push(child);
  }
  return out;
}

/** Trimmed text of a direct child element, or "" when missing. */
function txt(parent, tag) {
  const node = el(parent, tag);
  return node ? node.textContent.trim() : "";
}

/** Integer value of a direct child element, or 0 when missing/empty/invalid. */
function int(parent, tag) {
  const v = parseInt(txt(parent, tag), 10);
  return Number.isFinite(v) ? v : 0;
}

/** Sum of every direct child element parsed as an integer. */
function sumAll(node) {
  if (!node) return 0;
  let total = 0;
  for (const child of node.children) {
    const v = parseInt(child.textContent.trim(), 10);
    if (Number.isFinite(v)) total += v;
  }
  return total;
}

function isTrue(value) {
  return String(value).trim().toLowerCase() === "true";
}

/* -------------------------------------------- */
/*  Compatibility shims (v12–v14)               */
/* -------------------------------------------- */

function getRenderTemplate() {
  return foundry?.applications?.handlebars?.renderTemplate ?? globalThis.renderTemplate;
}

function getDialogClass() {
  return foundry?.appv1?.api?.Dialog ?? globalThis.Dialog;
}

function getRootElement(app) {
  if (!app?.element) return null;
  if (app.element instanceof HTMLElement) return app.element;
  return app.element[0] ?? null;
}

async function readFileText(file) {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/* -------------------------------------------- */
/*  Core import                                 */
/* -------------------------------------------- */

function gearDescriptors(root, containerTag, itemTag, type) {
  const container = el(root, containerTag);
  return els(container, itemTag).map((node) => {
    const itemKey = txt(node, "ItemKey");
    const uuid = txt(node, "Key");
    // Match on the catalog ItemKey; fall back to the per-instance Key (e.g.
    // innate "UNARMED") so unnamed entries don't import as literal tag names.
    const key = itemKey || uuid;
    return {
      type,
      key,
      name: key || itemTag,
      count: int(node, "Count") || 1,
      // Carried state and character-specific hard points the cloned catalog
      // item doesn't know about. <Equipped> drives `equippable.equipped`, which
      // the system needs set before it will apply armor/weapon soak & defence
      // (an unequipped item's inherent soak/defence effect resolves to 0).
      equipped: isTrue(txt(node, "Equipped")),
      addlHP: int(node, "AddlHP"),
      // Installed attachments (<PurchasedAttachments>) are linked from the
      // world's attachment compendia and merged into system.itemattachment.
      attachNode: el(node, "PurchasedAttachments"),
    };
  });
}

/* -------------------------------------------- */
/*  Attachments                                 */
/* -------------------------------------------- */

/**
 * Map an attachment/talent `attributes` entry to the actor-stat Active Effect
 * change(s) it should contribute. Only attributes that target a derived actor
 * stat produce a change; "Weapon Stat" (damage/crit) adjusts the item's own
 * display value and "Roll Modifiers" (Add Boost/Setback) are handled by the
 * system's dice logic, so both yield nothing here. The "Stat" mappings are
 * confirmed against the linked talent effects (Toughened→wounds, Enduring→soak,
 * Sixth Sense→defence.ranged, …); "Armor Stat"/soak is confirmed against the
 * Superior Armor Customization (SACUST) attachment reference.
 */
function attachmentStatChanges(a) {
  const modtype = String(a?.modtype ?? "");
  if (modtype !== "Armor Stat" && modtype !== "Stat") return [];
  const keys = {
    soak: ["system.stats.soak.value"],
    wounds: ["system.stats.wounds.max"],
    strain: ["system.stats.strain.max"],
    "defence-ranged": ["system.stats.defence.ranged"],
    "defense-ranged": ["system.stats.defence.ranged"],
    "defence-melee": ["system.stats.defence.melee"],
    "defense-melee": ["system.stats.defence.melee"],
    // Armor "Defence" applies to both tracks, mirroring an armor's inherent effect.
    defence: ["system.stats.defence.ranged", "system.stats.defence.melee"],
    defense: ["system.stats.defence.ranged", "system.stats.defence.melee"],
  }[String(a?.mod ?? "").toLowerCase()] ?? [];
  const value = String(a?.value ?? "");
  return keys.map((key) => ({ key, mode: CONST.ACTIVE_EFFECT_MODES.ADD, value }));
}

/** Minimal transfer Active Effect, shaped like the ones the system persists. */
function makeAttachmentEffect(name, changes) {
  return {
    name,
    changes,
    disabled: false,
    type: "base",
    system: {},
    duration: { startTime: null, combat: null },
    description: "",
    origin: null,
    tint: "#ffffff",
    transfer: true,
    statuses: [],
    sort: 0,
    flags: {},
  };
}

/**
 * Mark an attachment's installed mods active, matching the state the system
 * stores once a mod is crafted/installed. OggDude lists the final installed mod
 * set under <AllMods> (base + purchased) with a total <Count> per mod; the
 * system represents an installed mod as an itemmodifier with `system.active`
 * true and `system.rank` set to that count (confirmed against a reference
 * export: Integrated Holsters' base mods, and a crafted Accurate rank on a
 * Custom Grip). We only flip flags on mods the cloned catalog attachment
 * already carries (matched by ffgimportid) — never synthesising a mod whose
 * definition we lack. This is display/dice-pool only: actor stat bonuses still
 * travel through the separate parent `attr…` transfer effect path (see
 * attachmentStatChanges / SACUST), so marking a stat-bearing mod active here
 * never double-counts soak/defence. Keyless (MiscDesc) mods carry no catalog
 * key to match and are left as cloned.
 */
function applyCraftedMods(att, ci) {
  const mods = att.system?.itemmodifier;
  if (!Array.isArray(mods) || !mods.length) return;
  const ranks = new Map();
  for (const m of els(el(ci, "AllMods"), "Mod")) {
    const modKey = txt(m, "Key");
    if (!modKey) continue;
    ranks.set(modKey, (ranks.get(modKey) ?? 0) + (int(m, "Count") || 1));
  }
  for (const [modKey, rank] of ranks) {
    const mod = mods.find(
      (x) => foundry.utils.getProperty(x, "flags.starwarsffg.ffgimportid") === modKey
    );
    if (!mod) {
      console.warn(
        `${MODULE_ID} | ${txt(ci, "AttachKey")}: no catalog mod for installed "${modKey}"`
      );
      continue;
    }
    mod.system = mod.system ?? {};
    mod.system.active = true;
    mod.system.rank = rank;
  }
}

/**
 * Resolve every <CharItemAttachment> under a weapon/armor/gear's
 * <PurchasedAttachments> to a real attachment document and clone it. Returns
 * the cloned attachment objects (for system.itemattachment) plus the parent
 * Active Effects their stat-bearing attributes require — the system stores
 * those on the host item, not on the attachment, so a fresh clone needs them
 * added explicitly or the bonus never reaches the actor.
 */
async function buildAttachments(attachNode, report) {
  const attachments = [];
  const parentEffects = [];
  for (const ci of els(attachNode, "CharItemAttachment")) {
    const key = txt(ci, "AttachKey");
    if (!key) continue;
    const source = await resolveSource("itemattachment", key);
    if (!source) {
      report.stubbed.push(`itemattachment::${key}`);
      continue;
    }
    const att = source.obj;
    delete att._id;
    att.flags = att.flags ?? {};
    att.flags.starwarsffg = foundry.utils.mergeObject(att.flags.starwarsffg ?? {}, {
      ffgimportid: key,
      isCompendium: source.uuid.startsWith("Compendium."),
      ffgUuid: source.uuid,
    });
    for (const [attrKey, a] of Object.entries(att.system?.attributes ?? {})) {
      const changes = attachmentStatChanges(a);
      if (changes.length) parentEffects.push(makeAttachmentEffect(attrKey, changes));
    }
    applyCraftedMods(att, ci);
    report.matched.push(`itemattachment::${key}`);
    attachments.push(att);
  }
  return { attachments, parentEffects };
}

/** Descriptors for simple <Key>-only containers (sig abilities). */
function childKeyDescriptors(root, containerTag, type) {
  const container = el(root, containerTag);
  if (!container) return [];
  const out = [];
  for (const node of container.children) {
    const key = txt(node, "Key");
    if (key) out.push({ type, key, name: key });
  }
  return out;
}

/**
 * Force-power descriptors, filtered to powers the character actually invested
 * in. OggDude serializes the *entire* force-power catalog under <ForcePowers>;
 * a power is only owned when at least one of its <CharForceAbility> nodes is
 * <Purchased>. The node is carried through so cloneItem can mark the purchased
 * upgrades on the linked item's tree.
 */
function forcePowerDescriptors(root) {
  const container = el(root, "ForcePowers");
  if (!container) return [];
  const out = [];
  for (const power of els(container, "CharForcePower")) {
    const key = txt(power, "Key");
    if (!key) continue;
    const invested = els(el(power, "ForceAbilities"), "CharForceAbility").some(
      (a) => isTrue(txt(a, "Purchased"))
    );
    if (!invested) continue;
    out.push({ type: "forcepower", key, name: txt(power, "Name") || key, node: power });
  }
  return out;
}

/**
 * Mark every purchased talent as learned on a linked specialization's talent
 * tree. OggDude exports a 4-wide grid (Col 0-3, Row 0-4); the system stores
 * tree slots as talent{Row*4+Col} in both `system.talents` and (when present)
 * `system.collection`. The grid position is authoritative.
 */
function markLearnedTalents(obj, specNode) {
  for (const t of els(el(specNode, "Talents"), "CharTalent")) {
    if (!isTrue(txt(t, "Purchased"))) continue;
    const idx = int(t, "Row") * 4 + int(t, "Col");
    for (const bag of ["talents", "collection"]) {
      const path = `system.${bag}.talent${idx}`;
      if (foundry.utils.hasProperty(obj, path)) {
        foundry.utils.setProperty(obj, `${path}.islearned`, true);
      }
    }
  }
}

/**
 * Mark every purchased force-power upgrade as learned on a linked power. The
 * 4-wide upgrade grid (Col 0-3, Row 1-4) maps to upgrade{(Row-1)*4+Col} in both
 * `system.upgrades` and `system.collection`; Row 0 is the base power, which is
 * implied by owning the item and has no learned flag.
 */
function markLearnedForcePowerUpgrades(obj, powerNode) {
  for (const a of els(el(powerNode, "ForceAbilities"), "CharForceAbility")) {
    if (!isTrue(txt(a, "Purchased"))) continue;
    const row = int(a, "Row");
    if (row < 1) continue;
    const idx = (row - 1) * 4 + int(a, "Col");
    for (const bag of ["upgrades", "collection"]) {
      const path = `system.${bag}.upgrade${idx}`;
      if (foundry.utils.hasProperty(obj, path)) {
        foundry.utils.setProperty(obj, `${path}.islearned`, true);
      }
    }
  }
}

/**
 * Prepare a linked specialization to match the state the system itself reaches
 * once it lazily "loads" the spec: mark purchased talents learned, then enable
 * the per-talent stat Active Effects (Toughened/Grit/Enduring/Force Rating, …)
 * for exactly those purchased talents and disable the rest. A freshly cloned
 * spec ships every `attr…` effect disabled, so wounds/strain/soak/Force rating
 * read low until the sheet is opened; doing it here makes them correct on
 * import without double-counting (these effects are the system's only path for
 * talent stat bonuses).
 */
function prepareLinkedSpec(obj, specNode) {
  markLearnedTalents(obj, specNode);
  const learnedAttrs = new Set();
  for (const t of els(el(specNode, "Talents"), "CharTalent")) {
    if (!isTrue(txt(t, "Purchased"))) continue;
    const idx = int(t, "Row") * 4 + int(t, "Col");
    const node =
      foundry.utils.getProperty(obj, `system.talents.talent${idx}`) ??
      foundry.utils.getProperty(obj, `system.collection.talent${idx}`);
    if (node?.attributes) {
      for (const a of Object.keys(node.attributes)) learnedAttrs.add(a);
    }
  }
  for (const eff of obj.effects ?? []) {
    if (typeof eff?.name === "string" && eff.name.startsWith("attr")) {
      eff.disabled = !learnedAttrs.has(eff.name);
    }
  }
}

/* -------------------------------------------- */
/*  Source resolver (world items + compendia)   */
/* -------------------------------------------- */

const SOURCE_INDEX = new Map();

function isWorldPack(pack) {
  const m = pack.metadata ?? {};
  return (
    m.packageType === "world" ||
    m.package === "world" ||
    String(pack.collection).startsWith("world.")
  );
}

/**
 * Index every linkable Item by `${type}::${ffgimportid}`. World items are
 * indexed first so they win ties over world compendium entries.
 */
async function buildSourceIndex() {
  SOURCE_INDEX.clear();
  for (const it of game.items) {
    const k = it.getFlag?.("starwarsffg", "ffgimportid");
    if (k) SOURCE_INDEX.set(`${it.type}::${k}`, it.uuid);
  }
  for (const pack of game.packs) {
    if (pack.documentName !== "Item" || !isWorldPack(pack)) continue;
    let index;
    try {
      index = await pack.getIndex({
        fields: ["type", "flags.starwarsffg.ffgimportid"],
      });
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not index pack ${pack.collection}`, err);
      continue;
    }
    for (const entry of index) {
      const k = foundry.utils.getProperty(entry, "flags.starwarsffg.ffgimportid");
      if (!k) continue;
      const mapKey = `${entry.type}::${k}`;
      if (!SOURCE_INDEX.has(mapKey)) {
        SOURCE_INDEX.set(
          mapKey,
          `Compendium.${pack.collection}.${pack.documentName}.${entry._id}`
        );
      }
    }
  }
}

async function resolveSource(type, key) {
  if (!key) return null;
  const uuid = SOURCE_INDEX.get(`${type}::${key}`);
  if (!uuid) return null;
  try {
    const doc = await fromUuid(uuid);
    return doc ? { obj: doc.toObject(), uuid } : null;
  } catch (err) {
    console.warn(`${MODULE_ID} | Failed to load ${uuid}`, err);
    return null;
  }
}

/** Minimal placeholder used when nothing in the world/compendia matches. */
function stubItem(d) {
  const system = { quantity: { value: d.count ?? 1 } };
  if (d.extra) Object.assign(system, d.extra);
  return {
    name: d.name || d.key || d.type,
    type: d.type,
    flags: {
      starwarsffg: { ffgimportid: d.key },
      [MODULE_ID]: { generated: true },
    },
    system,
  };
}

/** A full copy of a matched source document, retagged for this import. */
async function cloneItem(source, d, report) {
  const obj = source.obj;
  delete obj._id;
  obj.name = obj.name || d.name;
  obj.flags = obj.flags ?? {};
  obj.flags.starwarsffg = foundry.utils.mergeObject(obj.flags.starwarsffg ?? {}, {
    ffgimportid: d.key,
    isCompendium: source.uuid.startsWith("Compendium."),
    ffgUuid: source.uuid,
  });
  obj.flags[MODULE_ID] = { generated: true };
  obj._stats = foundry.utils.mergeObject(obj._stats ?? {}, {
    compendiumSource: source.uuid,
  });
  if (d.count != null && foundry.utils.hasProperty(obj, "system.quantity.value")) {
    foundry.utils.setProperty(obj, "system.quantity.value", d.count);
  }
  // Equipped/held state — only weapons & armour carry `equippable`; gear omits
  // it, so the hasProperty guard naturally skips those.
  if (foundry.utils.hasProperty(obj, "system.equippable.equipped")) {
    foundry.utils.setProperty(obj, "system.equippable.equipped", !!d.equipped);
  }
  // <AddlHP> is extra hard-point capacity bought for this specific item (e.g.
  // via Tinkerer), on top of the catalog base — so it adds, not replaces.
  if (d.addlHP && foundry.utils.hasProperty(obj, "system.hardpoints.value")) {
    foundry.utils.setProperty(
      obj,
      "system.hardpoints.value",
      (foundry.utils.getProperty(obj, "system.hardpoints.value") || 0) + d.addlHP
    );
  }
  if (d.extra) {
    obj.system = foundry.utils.mergeObject(obj.system ?? {}, d.extra, {
      inplace: false,
    });
  }
  // Installed attachments: clone the linked attachment docs into the host
  // item and add the parent effects their stat attributes require.
  if (d.attachNode && foundry.utils.hasProperty(obj, "system.itemattachment")) {
    const { attachments, parentEffects } = await buildAttachments(d.attachNode, report);
    if (attachments.length) {
      const existing = foundry.utils.getProperty(obj, "system.itemattachment") ?? [];
      foundry.utils.setProperty(obj, "system.itemattachment", existing.concat(attachments));
    }
    if (parentEffects.length) obj.effects = (obj.effects ?? []).concat(parentEffects);
  }
  if (d.type === "specialization" && d.node) prepareLinkedSpec(obj, d.node);
  if (d.type === "forcepower" && d.node) markLearnedForcePowerUpgrades(obj, d.node);
  return obj;
}

async function buildEmbeddedItems(descriptors, report) {
  const out = [];
  for (const d of descriptors) {
    const source = await resolveSource(d.type, d.key);
    if (source) {
      out.push(await cloneItem(source, d, report));
      report.matched.push(`${d.type}::${d.key}`);
    } else {
      out.push(stubItem(d));
      report.stubbed.push(`${d.type}::${d.key || d.name}`);
    }
  }
  return out;
}

async function importXML(actor, xmlString) {
  const doc = new DOMParser().parseFromString(xmlString, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) {
    throw new Error("The selected file is not valid XML.");
  }

  let root = doc.documentElement;
  if (!root || root.tagName !== "Character") {
    root = doc.querySelector("Character");
  }
  if (!root) throw new Error("No <Character> element found in the XML.");

  const updateData = {};

  /* --- Basic info --- */
  const desc = el(root, "Description");
  const charName = txt(desc, "CharName");
  // Keep the Actor document name, the sheet header, and the prototype token all
  // in sync with the imported character's name.
  if (charName) {
    updateData.name = charName;
    updateData["prototypeToken.name"] = charName;
  }
  updateData["system.general.gender"] = txt(desc, "Gender");
  updateData["system.general.age"] = txt(desc, "Age");
  updateData["system.general.height"] = txt(desc, "Height");
  updateData["system.general.build"] = txt(desc, "Build");
  updateData["system.general.hair"] = txt(desc, "Hair");
  updateData["system.general.eyes"] = txt(desc, "Eyes");
  updateData["system.general.features"] = txt(desc, "OtherFeatures");
  updateData["system.biography"] = txt(root, "Story");
  updateData["system.stats.credits.value"] = int(root, "Credits");
  updateData["system.morality.value"] = int(el(root, "Morality"), "MoralityValue");

  /* --- Species & career (string fields kept for the sheet header; the same
   * keys are reused to link the species/career items further below) --- */
  const speciesKey = txt(el(root, "Species"), "SpeciesKey");
  const careerKey = txt(el(root, "Career"), "CareerKey");
  updateData["system.species.value"] = speciesKey;
  updateData["system.career.value"] = careerKey;

  /* --- Specializations --- */
  const specNodes = els(el(root, "Specializations"), "CharSpecialization");
  const specList = specNodes.map((s) => txt(s, "Name")).filter(Boolean);
  let primarySpec = "";
  for (const s of specNodes) {
    if (isTrue(txt(s, "isStartingSpec"))) {
      primarySpec = txt(s, "Name");
      break;
    }
  }
  if (!primarySpec && specList.length) primarySpec = specList[0];
  updateData["system.specialisation.value"] = primarySpec;
  updateData["system.specialisation.list"] = specList;

  /* --- Resolve & build embedded items FIRST ---
   * Stat writes below depend on what linked, so granted ranks/effects from
   * matched species/career/specialization items aren't double-counted. */
  await buildSourceIndex();
  const report = { matched: [], stubbed: [] };

  const descriptors = [
    ...gearDescriptors(root, "Weapons", "CharWeapon", "weapon"),
    ...gearDescriptors(root, "Armor", "CharArmor", "armour"),
    ...gearDescriptors(root, "Gear", "CharGear", "gear"),
  ];

  if (speciesKey) descriptors.push({ type: "species", key: speciesKey, name: speciesKey });
  if (careerKey) descriptors.push({ type: "career", key: careerKey, name: careerKey });

  for (const s of specNodes) {
    const sk = txt(s, "Key");
    if (sk) {
      descriptors.push({
        type: "specialization",
        key: sk,
        name: txt(s, "Name") || sk,
        node: s, // used to mark purchased talents on the linked tree
      });
    }
  }

  for (const o of els(el(root, "Obligations"), "CharObligation")) {
    const ok = txt(o, "ObKey");
    if (ok) {
      descriptors.push({
        type: "obligation",
        key: ok,
        name: txt(o, "Name") || ok,
        extra: { magnitude: int(o, "Size") },
      });
    }
  }

  descriptors.push(...forcePowerDescriptors(root));
  descriptors.push(...childKeyDescriptors(root, "SigAbilities", "signatureability"));

  const items = await buildEmbeddedItems(descriptors, report);

  /* Bake-into-base stats must not ALSO arrive as item Active Effects, or they
   * double on starwarsffg 2.x (where a stat = stored base + applied effects).
   * Strip the characteristic AND wound/strain-threshold change-lines from every
   * cloned item. The species item carries +Brawn/+Agility/… characteristic lines
   * and a wounds.max/strain.max line whose value bakes in a *fixed* characteristic
   * (e.g. Human's +12 = species 10 + an assumed Brawn/Willpower of 2 — which is
   * wrong whenever the character's creation Brawn/WP isn't 2); each Toughened/Grit
   * talent carries its own wounds.max/strain.max line too. We strip them all and
   * store the authoritative OggDude threshold total in the base below, so nothing
   * double-counts and the value can't drift on re-import. Soak and skill effect
   * lines are deliberately KEPT (soak rises with Brawn per the system, and skills
   * are reconciled separately via effectSkillRanks). */
  const BAKED_EFFECT_KEY =
    /^system\.(characteristics\..+\.value|stats\.(wounds|strain)\.max)$/;
  for (const it of items) {
    for (const eff of it.effects ?? []) {
      if (Array.isArray(eff.changes)) {
        eff.changes = eff.changes.filter((ch) => !BAKED_EFFECT_KEY.test(ch.key ?? ""));
      }
    }
  }

  /* --- Characteristics ---
   * Bake the FULL characteristic (purchased + species + talent) straight into the
   * actor base, now that the species item no longer contributes its own
   * characteristic effect (stripped just above). Storing the full value also
   * keeps starwarsffg 2.x's `_preUpdate` quiet on re-import: that handler only
   * recomputes the wounds/strain threshold when an update's Brawn/Willpower
   * differs from the actor's current (effect-derived) value. Because the written
   * base now equals the derived value, a re-import is a no-op for it — which is
   * what stops the threshold from growing a little every time. */
  const charValues = {};
  for (const node of els(el(root, "Characteristics"), "CharCharacteristic")) {
    const key = txt(node, "Key");
    const jsonName = CHARACTERISTIC_MAP[key];
    if (!jsonName) continue;
    charValues[jsonName] = sumAll(el(node, "Rank"));
    updateData[`system.characteristics.${jsonName}.value`] = charValues[jsonName];
  }

  /* --- Derived stats: defence has no characteristic base, so we write it to the
   * base stat. But OggDude's <DefenseRanged/Melee><PurchasedRanks> is the total
   * *armour-derived* defence (armour base + attachment bonuses), and an equipped
   * armour's own (inherent) effect re-adds its base defence on top — so subtract
   * the equipped armour's base defence to avoid counting it twice. (Mirrors soak,
   * which relies entirely on the armour effect and writes nothing to the base.)
   * wounds/strain/soak/encumbrance come from the synthetic effect (only when no
   * species links) or the linked items' own effects. */
  const attr = el(root, "Attributes");
  const armourDefence = items.reduce((sum, it) => {
    if (it.type !== "armour") return sum;
    if (!foundry.utils.getProperty(it, "system.equippable.equipped")) return sum;
    return sum + (Number(foundry.utils.getProperty(it, "system.defence.value")) || 0);
  }, 0);
  updateData["system.stats.defence.ranged"] = Math.max(
    0,
    int(el(attr, "DefenseRanged"), "PurchasedRanks") - armourDefence
  );
  updateData["system.stats.defence.melee"] = Math.max(
    0,
    int(el(attr, "DefenseMelee"), "PurchasedRanks") - armourDefence
  );

  /* Wounds/strain thresholds, current damage, and experience are written in a
   * single dedicated update AFTER the items are (re)created — see the end of this
   * function. Doing it last lets our values win over whatever the system's item
   * create/delete lifecycle writes (notably the species-removal XP "undo"), and
   * keeping characteristics out of that final update avoids re-triggering the
   * `_preUpdate` threshold recompute. */

  /* --- Experience (written in the final update below) ---
   * OggDude's <ExperienceRanks> holds only *creation* XP (starting + species);
   * XP a GM awarded during play is NOT exported here. A fully-built character can
   * therefore report used > earned, which would make `available` negative. Floor
   * the total at what's been spent (they must have earned at least that much), so
   * a finished character imports with available = 0 instead of a negative number,
   * while an under-spent creation-only character still shows its leftover. */
  const exp = el(root, "Experience");
  const earnedXP = sumAll(el(exp, "ExperienceRanks"));
  const usedXP = int(exp, "UsedExperience");
  const totalXP = Math.max(earnedXP, usedXP);

  /* --- Obligations --- */
  const oblTotal = els(el(root, "Obligations"), "CharObligation").reduce(
    (acc, o) => acc + int(o, "Size"),
    0
  );
  updateData["system.obligation.value"] = oblTotal;

  /* --- Skills ---
   * Career and specialization items only flip the `careerskill` boolean, so
   * the additive rank components (StartingRanks, SpeciesRanks, CareerRanks,
   * PurchasedRanks, TalentRanks) generally must be baked into the stored rank.
   *
   * EXCEPT NonCareerRanks: OggDude records each XP-purchased rank in a
   * non-career-priced skill under BOTH <PurchasedRanks> and <NonCareerRanks>
   * (the latter is only a pricing tag), so summing it double-counts — e.g.
   * Ranged: Light reads Species 1 + Purchased 3 + NonCareer 3 = 7 (over the
   * skill max of 6). <CareerRanks>, by contrast, is genuinely additive free
   * ranks from the career/starting-spec skill picks and is kept.
   *
   * EXCEPT effect-granted ranks: some species DO carry a fixed free skill rank
   * as a real Active Effect (e.g. Mikkian's `system.skills.Discipline.rank` +1),
   * which the system re-adds on the sheet. The XML also records that rank under
   * <SpeciesRanks>, so baking it in AND keeping the effect double-counts
   * (Discipline → 2). We therefore subtract whatever the linked items' own
   * enabled effects actually contribute (effectSkillRanks below). This is NOT a
   * blanket SpeciesRanks subtraction: player-chosen species skills (e.g. Human's
   * two free Non-Career skills) appear as <SpeciesRanks> but carry no effect, so
   * they stay baked in and are left untouched.
   *
   * careerskill is written straight from the XML's authoritative <isCareer>
   * rather than trusting item effects, which can be incomplete (e.g. a
   * specialization whose (inherent) effect has unresolved "(none)" keys). */
  const effectSkillRanks = {};
  for (const it of items) {
    for (const eff of it.effects ?? []) {
      if (eff.disabled) continue;
      for (const ch of eff.changes ?? []) {
        const m = /^system\.skills\.(.+)\.rank$/.exec(ch.key ?? "");
        if (m && Number(ch.mode) === CONST.ACTIVE_EFFECT_MODES.ADD) {
          effectSkillRanks[m[1]] =
            (effectSkillRanks[m[1]] ?? 0) + (parseInt(ch.value, 10) || 0);
        }
      }
    }
  }
  for (const node of els(el(root, "Skills"), "CharSkill")) {
    const key = txt(node, "Key");
    const jsonName = SKILL_MAP[key];
    if (!jsonName) continue;
    const rank = el(node, "Rank");
    const baked =
      sumAll(rank) - int(rank, "NonCareerRanks") - (effectSkillRanks[jsonName] ?? 0);
    updateData[`system.skills.${jsonName}.rank`] = Math.max(0, baked);
    updateData[`system.skills.${jsonName}.careerskill`] = isTrue(txt(node, "isCareer"));
  }

  /* --- Portrait --- */
  const portraitNode = el(root, "Portrait");
  const portrait = portraitNode ? portraitNode.textContent.replace(/\s+/g, "") : "";
  if (portrait) {
    const portraitData = `data:image/jpeg;base64,${portrait}`;
    updateData.img = portraitData;
    // Use the same portrait for the prototype token so the map token matches.
    updateData["prototypeToken.texture.src"] = portraitData;
  }

  /* --- Write to the actor --- */
  await actor.update(updateData);

  // Wipe the actor back to a blank slate before re-populating, so an import is
  // always a fresh, full replacement rather than an additive overlay. This
  // clears every embedded item and every actor-owned Active Effect (including
  // ones added by hand or by a prior import), preventing duplicate items and
  // stacked additive stat bonuses on re-import. The fresh items/effects built
  // from the XML are created immediately below.
  const allEffectIds = actor.effects.map((e) => e.id);
  if (allEffectIds.length) {
    await actor.deleteEmbeddedDocuments("ActiveEffect", allEffectIds);
  }
  const allItemIds = actor.items.map((i) => i.id);
  if (allItemIds.length) {
    await actor.deleteEmbeddedDocuments("Item", allItemIds);
  }

  if (items.length) await actor.createEmbeddedDocuments("Item", items);

  /* --- Finalize thresholds, current damage, and XP (must run LAST) ---
   * Threshold model on starwarsffg 2.x: a stat = stored base + applied effects.
   * We stripped the wounds.max/strain.max effect lines off every item above, so
   * the stored base IS the whole threshold. Use OggDude's own tally — the sum of
   * every <WoundThreshold>/<StrainThreshold> component (species base + creation
   * characteristic + talent ranks). This matches the FFG rule the system encodes
   * in _preUpdate (post-creation Dedication characteristic bumps do NOT raise the
   * threshold) and can't double-count or drift, since no item effect touches it
   * anymore. Works whether or not a species item linked.
   *
   * This update contains NO characteristics, so `_preUpdate` does not recompute
   * (and therefore cannot inflate) the thresholds. It also rewrites experience
   * and clears the xpLog flag, undoing the bogus "undid Species XP" entries and
   * negative `available` produced when the system reacted to the old species
   * item being deleted earlier in this import. */
  const woundsMax = sumAll(el(attr, "WoundThreshold"));
  const strainMax = sumAll(el(attr, "StrainThreshold"));
  await actor.update({
    "system.stats.wounds.max": woundsMax,
    "system.stats.strain.max": strainMax,
    "system.stats.wounds.value": 0,
    "system.stats.strain.value": 0,
    "system.experience.total": totalXP,
    "system.experience.available": totalXP - usedXP,
    "flags.starwarsffg.xpLog": [],
  });

  // Equipped armour/weapon items ship a frozen `(inherent)` soak/defence effect
  // captured while the catalog item was unequipped (so it resolves to 0). The
  // system only rebuilds it from `system.soak.value` when the item's data is
  // re-prepared — which a manual sheet open/close forces. Do that here so the
  // derived Soak/Defence are correct immediately, without user intervention.
  actor.reset();
  actor.sheet?.render(false);

  ui.notifications.info(
    `Imported "${charName || actor.name}" — ${report.matched.length} linked, ` +
      `${report.stubbed.length} stubbed.`
  );
  if (report.stubbed.length) {
    console.warn(`${MODULE_ID} | Unmatched (stubbed): ${report.stubbed.join(", ")}`);
    ui.notifications.warn(
      `${report.stubbed.length} entr${report.stubbed.length === 1 ? "y" : "ies"} ` +
        `had no world/compendium match — see console (F12) for keys.`
    );
  }
}

/* -------------------------------------------- */
/*  Dialog                                      */
/* -------------------------------------------- */

const FALLBACK_DIALOG_HTML = `
<form class="ffg-xml-import-form">
  <p>Select an OggDude character XML file to import into this actor.</p>
  <div class="form-group">
    <label for="ffg-xml-file">XML File</label>
    <input type="file" id="ffg-xml-file" name="ffg-xml-file" accept=".xml,application/xml,text/xml" />
  </div>
  <p class="notes"><strong>This replaces the character.</strong> All existing items and effects are removed first, then the imported character is written in fresh.</p>
</form>`;

async function openImportDialog(actor) {
  let content = FALLBACK_DIALOG_HTML;
  try {
    const renderTemplate = getRenderTemplate();
    if (renderTemplate) content = await renderTemplate(TEMPLATE, {});
  } catch (err) {
    console.warn(`${MODULE_ID} | Falling back to inline dialog HTML.`, err);
  }

  const DialogCls = getDialogClass();
  new DialogCls({
    title: "Import OggDude XML Character",
    content,
    buttons: {
      import: {
        icon: '<i class="fas fa-file-import"></i>',
        label: "Import",
        callback: async (html) => {
          const rootEl = html instanceof HTMLElement ? html : html[0];
          const input = rootEl.querySelector('input[type="file"]');
          const file = input?.files?.[0];
          if (!file) {
            ui.notifications.error("No XML file selected.");
            return;
          }
          try {
            const text = await readFileText(file);
            await importXML(actor, text);
          } catch (err) {
            console.error(`${MODULE_ID} | Import failed.`, err);
            ui.notifications.error(`XML import failed: ${err.message}`);
          }
        },
      },
      cancel: {
        icon: '<i class="fas fa-times"></i>',
        label: "Cancel",
      },
    },
    default: "import",
  }).render(true);
}

/* -------------------------------------------- */
/*  Sheet header button injection               */
/* -------------------------------------------- */

function injectButton(app) {
  try {
    if (game.system.id !== "starwarsffg") return;
    const actor = app.actor ?? app.document;
    if (!actor || actor.type !== "character") return;

    const rootEl = getRootElement(app);
    if (!rootEl) return;
    const header = rootEl.querySelector(".window-header");
    if (!header) return;
    if (header.querySelector(".ffg-xml-import")) return;

    const btn = document.createElement("a");
    btn.className = "header-button control ffg-xml-import";
    btn.innerHTML = '<i class="fas fa-file-import"></i> Import XML';
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openImportDialog(actor);
    });

    const closeBtn = header.querySelector(".close, [data-action='close']");
    if (closeBtn) header.insertBefore(btn, closeBtn);
    else header.appendChild(btn);
  } catch (err) {
    console.error(`${MODULE_ID} | Failed to inject import button.`, err);
  }
}

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initialized.`);
});

// The FFG actor sheet (ApplicationV1) fires renderActorSheetFFG; the generic
// renderActorSheet hook is a safety net. injectButton is idempotent.
Hooks.on("renderActorSheetFFG", (app) => injectButton(app));
Hooks.on("renderActorSheet", (app) => injectButton(app));
