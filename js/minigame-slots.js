/* Minigame hook slots (Hack Lab, Cipher Lab, Dossier Deduction). A slot is just a name the desk can open.
   Nothing is locked or gated until a minigame registers itself, so empty slots never block play.
   register(kind, { title, blurb, open(ctx) }); open(kind, ctx) -> true if a minigame ran. */
(function (global) {
  "use strict";
  var SLOTS = {
    hack: { title: "Hack Lab", blurb: "Break into a suspect's files." },
    cipher: { title: "Cipher Lab", blurb: "Crack coded messages." },
    dossier: { title: "Dossier Deduction", blurb: "Work out who the suspect is." },
    unblur: { title: "Flag Unblur", blurb: "Name the flag before it sharpens." }
  };
  var impl = {};
  function register(kind, def) { if (!SLOTS[kind] || !def || typeof def.open !== "function") return false; impl[kind] = def; return true; }
  function has(kind) { return !!impl[kind]; }
  function open(kind, ctx) { return has(kind) ? (impl[kind].open(ctx || {}), true) : false; }
  function list() { return Object.keys(SLOTS).map(function (k) { return { kind: k, title: SLOTS[k].title, blurb: SLOTS[k].blurb, ready: has(k) }; }); }
  global.MinigameSlots = { register: register, has: has, open: open, list: list, SLOTS: SLOTS };
})(typeof window !== "undefined" ? window : globalThis);
