/* The Chief's commendation calls. Voice matches the Chief in index.html (pitch 0.95, rate 0.97, calm and
   short, chime). Timing follows the travel-time mode:
     real time    -> every achievement rings through right away, as its own call
     mission time -> in-mission milestones are held and folded into ONE call at mission wrap-up
   Wrap-up achievements (case closed, promotion, new agent, level-up, ring leader, solved-case milestones)
   always arrive at wrap-up, which is also "right away" because that is when they happen. */
(function (global) {
  "use strict";
  var CHIEF = { id: "chief", name: "The Chief", voice: { pitch: 0.95, rate: 0.97 }, foley: "chime", prefer: ["ryan", "guy", "daniel", "arthur", "david", "uk english"] };
  var MID = {
    firstTrail: { once: true, line: "First lead on the board. Good. Keep your agents moving." },
    lucky: { line: "I heard about that break. Lucky, maybe. Sharp agents make their own luck." },
    located: { line: "Your agent says the suspect is close. Print the warrant before anyone moves." },
    warrant: { line: "Warrant is on file. Make the arrest in the right city." }
  };
  var MILESTONES = { 1: "That is your first case solved.", 3: "Three cases closed. The agency is taking notice.", 5: "Five cases closed. That is a real record.", 10: "Ten cases closed. Few reach that.", 15: "Fifteen cases closed. Legend material." };

  function ensure(state) { if (!state.chief) state.chief = { given: {}, queue: [] }; return state.chief; }
  function addCall(c, ctx, text, key) {
    var CE = global.CaseEngine;
    return CE.addComm(c, ctx, { id: "chief-" + key + "-" + ctx.now, type: "hq", text: text, channel: "call", chief: true });
  }

  // Mid-mission achievement. data: optional extra. Returns the comm when a call went out now.
  function award(state, c, ctx, key, data) {
    var def = MID[key], ch = ensure(state); if (!def) return null;
    var id = def.once ? key : key + ":" + c.id;
    if (ch.given[id]) return null;
    ch.given[id] = true;
    if (ctx.timeMode === "real") return addCall(c, ctx, def.line, key);
    ch.queue.push({ caseId: c.id, key: key, line: def.line });
    return null;
  }

  // Mission wrap-up: held lines for this case plus the wrap-up achievements, as one call.
  function wrapUp(state, c, ctx, summary, solvedCount) {
    var ch = ensure(state), lines = [], kept = [];
    ch.queue.forEach(function (q) { if (q.caseId === c.id) lines.push(q.line); else kept.push(q); });
    ch.queue = kept;
    if (summary) {
      lines.push(summary.rankAfter && summary.rankBefore !== summary.rankAfter ? "Promotion approved. You are now " + summary.rankAfter + "." : (summary.falseArrests || summary.wrongTrips ? "Case closed. Clean it up next time." : "Case closed. No wrong turns. That is how it is done."));
      (summary.unlockedAgents || []).forEach(function (id) { var d = global.AgentRoster && global.AgentRoster.byId(id); if (d) lines.push(d.name.split(" ")[0] + " is joining your crew. Show them the ropes."); });
      (summary.agents || []).filter(function (a) { return a && a.leveledUp; }).forEach(function (a) { var d = global.AgentRoster && global.AgentRoster.byId(a.id); if (d) lines.push(d.name.split(" ")[0] + " stepped up a level. Your orders did that."); });
      if (summary.ring && summary.ring.leaderExposed) lines.push("The ring leader has shown their face. Expect a big case.");
      if (summary.ring && summary.ring.leaderCaught) lines.push("The ring leader is behind bars. Outstanding.");
      if (MILESTONES[solvedCount] && !ch.given["m" + solvedCount]) { ch.given["m" + solvedCount] = true; lines.push(MILESTONES[solvedCount]); }
    }
    if (!lines.length) return null;
    return addCall(c, ctx, lines.join(" "), "wrap");
  }

  global.ChiefCalls = { CHIEF: CHIEF, MID: MID, MILESTONES: MILESTONES, award: award, wrapUp: wrapUp, ensure: ensure };
})(typeof window !== "undefined" ? window : globalThis);
