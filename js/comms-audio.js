/* Calls and voicemails: chunked speech + a live, synced waveform + radio squelch. Self-contained.
   - Voice: speechSynthesis, short clause chunks with brief pauses, per-speaker pitch/rate, best English voice.
   - Waveform: SYNTHETIC. Browsers do not expose speechSynthesis audio to Web Audio, so the envelope is built
     from the transcript (chunk length, punctuation, seeded jitter) and timed from the chunk start/end events.
   - Web Audio only makes the squelch clicks and a faint noise bed (bandpass). The voice itself is not filtered.
   - If the tablet has no speech voices the call still "plays" silently with the waveform and live transcript. */
(function (global) {
  "use strict";
  var MS_PER_CHAR = 62, PAUSE_MS = 220, SLOT_MS = 60;
  function mulberry(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  function chunk(text) {
    var parts = String(text || "").replace(/\s+/g, " ").match(/[^.!?;:,—]+[.!?;:,—]*/g) || [];
    var out = [];
    parts.forEach(function (p) {
      p = p.trim(); if (!p) return;
      while (p.length > 90) { var cut = p.lastIndexOf(" ", 80); if (cut < 20) cut = 80; out.push(p.slice(0, cut).trim()); p = p.slice(cut).trim(); }
      if (p) out.push(p);
    });
    return out;
  }

  // Pure and testable: {chunks:[{text,startMs,durMs,amps:[0..1 per 60ms]}], totalMs}
  function envelope(text, seed, rate) {
    var rng = mulberry(typeof seed === "number" ? seed : 1), r = Math.max(0.5, Number(rate) || 1), t = 0, chunks = [];
    chunk(text).forEach(function (txt) {
      var dur = Math.max(400, Math.round(txt.length * MS_PER_CHAR / r)), n = Math.ceil(dur / SLOT_MS), amps = [], ph = rng() * 6;
      for (var i = 0; i < n; i += 1) {
        var syll = 0.5 + 0.5 * Math.sin(ph + i * 0.9 + Math.sin(i * 0.37) * 1.4);          // syllable-ish rhythm
        var edge = Math.min(1, i / 3, (n - 1 - i) / 3);                                       // soft start and end
        amps.push(Math.max(0.05, Math.min(1, (0.25 + 0.75 * syll) * (0.6 + 0.4 * rng()) * Math.max(0.2, edge))));
      }
      chunks.push({ text: txt, startMs: t, durMs: dur, amps: amps });
      t += dur + PAUSE_MS;
    });
    return { chunks: chunks, totalMs: t };
  }

  function pickVoice(voices, prefer) {
    var en = (voices || []).filter(function (v) { return /^en/i.test(v.lang || ""); });
    var pool = en.length ? en : (voices || []);
    for (var i = 0; i < (prefer || []).length; i += 1) {
      var hit = pool.filter(function (v) { return (v.name || "").toLowerCase().indexOf(prefer[i]) !== -1; })[0];
      if (hit) return hit;
    }
    return pool.filter(function (v) { return v["default"]; })[0] || pool[0] || null;
  }

  var ac = null, bed = null, session = 0, raf = 0, timers = [];
  function audio() {
    if (ac) return ac;
    var C = global.AudioContext || global.webkitAudioContext; if (!C) return null;
    try { ac = new C(); } catch (e) { ac = null; } return ac;
  }
  function burst(ms, freq, gain) {
    var a = audio(); if (!a) return;
    try {
      if (a.state === "suspended" && a.resume) a.resume();
      var len = Math.max(1, Math.floor(a.sampleRate * ms / 1000)), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
      for (var i = 0; i < len; i += 1) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      var src = a.createBufferSource(), bp = a.createBiquadFilter(), g = a.createGain();
      src.buffer = buf; bp.type = "bandpass"; bp.frequency.value = freq || 1800; bp.Q.value = 0.9; g.gain.value = gain || 0.25;
      src.connect(bp); bp.connect(g); g.connect(a.destination); src.start();
    } catch (e) {}
  }
  function startBed() {
    var a = audio(); if (!a) return;
    try {
      var len = a.sampleRate * 2, buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
      for (var i = 0; i < len; i += 1) d[i] = Math.random() * 2 - 1;
      var src = a.createBufferSource(), bp = a.createBiquadFilter(), g = a.createGain();
      src.buffer = buf; src.loop = true; bp.type = "bandpass"; bp.frequency.value = 1500; bp.Q.value = 0.7; g.gain.value = 0.012;
      src.connect(bp); bp.connect(g); g.connect(a.destination); src.start(); bed = { src: src };
    } catch (e) {}
  }
  function stopBed() { try { if (bed) bed.src.stop(); } catch (e) {} bed = null; }

  function draw(canvas, env, startAt, activeIdx) {
    var g = canvas.getContext && canvas.getContext("2d"); if (!g) return;
    var w = canvas.width = canvas.clientWidth || 300, h = canvas.height = canvas.clientHeight || 60, mid = h / 2;
    g.clearRect(0, 0, w, h);
    var total = Math.max(1, env.totalMs), now = performance.now() - startAt;
    var bars = Math.floor(w / 5);
    for (var i = 0; i < bars; i += 1) {
      var t = (i / bars) * total, c = null;
      for (var k = 0; k < env.chunks.length; k += 1) if (t >= env.chunks[k].startMs && t < env.chunks[k].startMs + env.chunks[k].durMs) { c = env.chunks[k]; break; }
      var amp = c ? c.amps[Math.min(c.amps.length - 1, Math.floor((t - c.startMs) / SLOT_MS))] : 0.04;
      var played = t <= now, live = Math.abs(t - now) < 260;
      g.fillStyle = live ? "#FFD76B" : played ? "#6FE3B0" : "#4A4380";
      var bh = Math.max(3, amp * (h - 8) * (live ? 1 + 0.15 * Math.sin(now / 40) : 1));
      g.fillRect(i * 5, mid - bh / 2, 3, bh);
    }
  }

  // item: {transcript|body, voice:{pitch,rate}, id}. ui: {canvas, onChunk(i, text), onEnd(), prefer, silent}
  function play(item, ui) {
    stop(); ui = ui || {};
    var me = ++session, text = (item.transcript && item.transcript.join(" ")) || item.body || "";
    var env = envelope(text, global.CrumpledNotes ? global.CrumpledNotes.hash(String(item.id || "x")) : 7, item.voice && item.voice.rate);
    var synth = global.speechSynthesis, voices = synth && synth.getVoices ? synth.getVoices() : [], voice = pickVoice(voices, ui.prefer);
    var start = performance.now(), idx = -1;
    burst(110, 2200, 0.28); startBed();
    function frame() { if (me !== session) return; draw(ui.canvas, env, start, idx); raf = requestAnimationFrame(frame); }
    if (ui.canvas) frame();
    function finish() { if (me !== session) return; burst(140, 1500, 0.3); stopBed(); cancelAnimationFrame(raf); if (ui.canvas) draw(ui.canvas, env, start - env.totalMs - 1000, idx); if (ui.onEnd) ui.onEnd(); }
    var useVoice = !!(synth && voices.length && !ui.silent && global.SpeechSynthesisUtterance);
    function next(i) {
      if (me !== session) return;
      if (i >= env.chunks.length) { finish(); return; }
      idx = i; start = performance.now() - env.chunks[i].startMs;         // keep the playhead locked to the chunk being spoken
      if (ui.onChunk) ui.onChunk(i, env.chunks[i].text);
      var done = false, after = function () { if (done || me !== session) return; done = true; timers.push(setTimeout(function () { next(i + 1); }, PAUSE_MS)); };
      if (useVoice) {
        try {
          var u = new global.SpeechSynthesisUtterance(env.chunks[i].text);
          u.pitch = (item.voice && item.voice.pitch) || 1; u.rate = (item.voice && item.voice.rate) || 1; u.lang = "en-US"; if (voice) u.voice = voice;
          u.onend = after; u.onerror = after; synth.speak(u);
          timers.push(setTimeout(after, env.chunks[i].durMs * 2 + 1500));   // some tablets never fire onend
          return;
        } catch (e) {}
      }
      timers.push(setTimeout(after, env.chunks[i].durMs));
    }
    try { if (synth) synth.cancel(); } catch (e) {}
    next(0);
    return { env: env, voiced: useVoice };
  }
  function stop() {
    session += 1; cancelAnimationFrame(raf); timers.forEach(clearTimeout); timers = []; stopBed();
    try { if (global.speechSynthesis) global.speechSynthesis.cancel(); } catch (e) {}
  }

  // Two-note ring / chime for an incoming call (Web Audio oscillators, no files).
  function chime(kind) {
    var a = audio(); if (!a) return;
    try {
      if (a.state === "suspended" && a.resume) a.resume();
      var notes = kind === "chief" ? [660, 880] : [880, 660, 880];
      notes.forEach(function (f, i) {
        var o = a.createOscillator(), g = a.createGain(), t = a.currentTime + i * 0.22;
        o.type = "sine"; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
        o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + 0.22);
      });
    } catch (e) {}
  }

  global.CommsAudio = { chime: chime, chunk: chunk, envelope: envelope, pickVoice: pickVoice, play: play, stop: stop, SLOT_MS: SLOT_MS, PAUSE_MS: PAUSE_MS };
})(typeof window !== "undefined" ? window : globalThis);
