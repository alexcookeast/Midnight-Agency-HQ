/* Source reliability for field reports (Wave 3).
   Tags: confirmed / witness / rumour. Chance a report is WRONG: 0% / 10% / 30%, and only from
   Junior Analyst (ladder level 3) up. Recruit and Rookie reports are never wrong.
   Less-reliable sources carry subtle verbal tells ("sounded a little unsure"), mostly on the wrong ones
   but sometimes on correct ones, so a hint is a nudge, never proof. */
(function (global) {
  "use strict";
  var WRONG_RATE = { confirmed: 0, witness: 0.10, rumour: 0.30 };
  var MIN_LEVEL = 3;
  var TAG_LABEL = { confirmed: "Confirmed", witness: "Witness", rumour: "Rumour" };
  var HINTS = {
    witness: ["They paused a moment before answering.", "They sounded a little unsure.", "They glanced away while they talked.", "It was dark, they said, but they think so."],
    rumour: ["It came from someone who heard it from someone else.", "Two people told it slightly differently.", "The story had grown a bit by the time it reached us.", "Nobody could say exactly who started it."]
  };
  var SOLID = ["They answered straight away.", "They looked right at the agent.", "They had the detail ready."];

  // How a report's source is chosen: records are the firmest, a nosy neighbour the softest.
  function sourceFor(focusId, rng) {
    var r = rng();
    if (focusId === "records") return r < 0.7 ? "confirmed" : "witness";
    if (focusId === "transit") return r < 0.35 ? "confirmed" : (r < 0.8 ? "witness" : "rumour");
    return r < 0.15 ? "confirmed" : (r < 0.6 ? "witness" : "rumour");   // locals
  }

  function roll(rng, rankLevel, tag) {
    var level = Math.max(1, Math.floor(Number(rankLevel) || 1));
    var wrongRate = level >= MIN_LEVEL ? WRONG_RATE[tag] : 0;
    var wrong = wrongRate > 0 && rng() < wrongRate;
    return { tag: tag, label: TAG_LABEL[tag], wrong: wrong, hint: hint(tag, wrong, rng, level) };
  }

  // Hints only exist for sources that can be wrong, so young agents never get a tell with nothing behind it.
  function hint(tag, wrong, rng, level) {
    if (tag === "confirmed" || level < MIN_LEVEL) return null;
    var show = wrong ? rng() < 0.8 : rng() < 0.25;
    if (!show) return rng() < 0.3 ? SOLID[Math.floor(rng() * SOLID.length)] : null;
    var list = HINTS[tag];
    return list[Math.floor(rng() * list.length)];
  }

  global.Reliability = { WRONG_RATE: WRONG_RATE, MIN_LEVEL: MIN_LEVEL, TAG_LABEL: TAG_LABEL, HINTS: HINTS, sourceFor: sourceFor, roll: roll };
})(typeof window !== "undefined" ? window : globalThis);
