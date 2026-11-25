(function () {
  'use strict';

  var STORAGE_KEY = 'midnight_agency_config_v1';
  var EVENT_NAME = 'ma:config-updated';
  var SANTA_LINES = ['Ho ho ho!', 'Merry Christmas!'];
  var greetingIdx = 0;
  var hohoTimer = null;
  var sleighActive = true;
  var sleighSpeedMult = 1.0;
  var sleighProgress = 0.06;
  var lastFrameTime = null;
  var sleighPath = { baseY: 74, ampY: 22, waves: 1, tilt: 3 };

  function $(id) { return document.getElementById(id); }
  function rnd(n) { return Math.floor(Math.random() * n); }

  function readConfig() {
    var fallback = {
      christmasEnabled: true,
      snowDensity: 45,
      snowSpeed: 1.0
    };
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      var density = parsed && typeof parsed.snowDensity === 'number' && !isNaN(parsed.snowDensity)
        ? parsed.snowDensity
        : fallback.snowDensity;
      var speed = parsed && typeof parsed.snowSpeed === 'number' && !isNaN(parsed.snowSpeed)
        ? parsed.snowSpeed
        : fallback.snowSpeed;
      return {
        christmasEnabled: parsed && parsed.christmasEnabled !== undefined ? !!parsed.christmasEnabled : fallback.christmasEnabled,
        snowDensity: Math.max(0, Math.min(100, Number(density))),
        snowSpeed: Math.max(0.2, Math.min(4.0, Number(speed)))
      };
    } catch (e) {
      return fallback;
    }
  }

  function injectStyles() {
    if ($('maHolidayStyles')) return;
    var style = document.createElement('style');
    style.id = 'maHolidayStyles';
    style.textContent = [
      '.ma-holiday-layer{display:none;position:fixed;inset:0;pointer-events:none;z-index:20;overflow:hidden}',
      '.ma-holiday-active .ma-holiday-layer{display:block}',
      '.ma-flake{position:absolute;top:-28px;pointer-events:none;animation:maSnowFall linear infinite}',
      '.ma-flake--dot{border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(58,31,16,.24)}',
      '.ma-flake--svg{color:#fff;filter:drop-shadow(0 1px 1.5px rgba(58,31,16,.25))}',
      '.ma-flake--svg svg{display:block;width:100%;height:100%;animation:maFlakeSpin var(--spin-dur,9s) linear infinite}',
      '@keyframes maFlakeSpin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}',
      '@keyframes maSnowFall{0%{transform:translate3d(0,-28px,0)}50%{transform:translate3d(var(--drift,16px),50vh,0)}100%{transform:translate3d(calc(var(--drift,16px)*-0.5),106vh,0)}}',
      '.ma-sleigh-wrap{position:fixed;top:0;left:0;width:310px;height:104px;pointer-events:auto;cursor:pointer;user-select:none;-webkit-tap-highlight-color:transparent;filter:drop-shadow(0 8px 12px rgba(58,31,16,.28));will-change:transform}',
      '.ma-sleigh-wrap svg{display:block;width:310px;height:104px}',
      '.ma-sleigh-bubble{position:absolute;top:-34px;left:155px;transform:translateX(-50%) scale(0.9);opacity:0;pointer-events:none;background:#FFFDF9;color:#B8260F;border:2px solid #2F7D3A;border-radius:14px;padding:4px 11px;font:800 14px/1.2 Georgia,"Times New Roman",serif;white-space:nowrap;box-shadow:0 4px 10px rgba(58,31,16,.22);transition:opacity .16s ease,transform .16s ease}',
      '.ma-sleigh-bubble::after{content:"";position:absolute;left:50%;bottom:-6px;transform:translateX(-50%);border-width:6px 6px 0;border-style:solid;border-color:#2F7D3A transparent transparent}',
      '.ma-sleigh-wrap.ma-speaking .ma-sleigh-bubble{opacity:1;transform:translateX(-50%) translateY(-4px) scale(1)}',
      '.ma-reindeer-leg-a{transform-origin:222px 54px;animation:maGallopA .52s ease-in-out infinite alternate}',
      '.ma-reindeer-leg-b{transform-origin:244px 54px;animation:maGallopB .52s ease-in-out infinite alternate}',
      '.ma-star-twinkle{transform-box:fill-box;transform-origin:center;animation:maTwinkle 2s ease-in-out infinite alternate}',
      '.ma-lantern-glow{animation:maLanternPulse 1.6s ease-in-out infinite alternate}',
      '@keyframes maGallopA{from{transform:rotate(-16deg)}to{transform:rotate(18deg)}}',
      '@keyframes maGallopB{from{transform:rotate(18deg)}to{transform:rotate(-16deg)}}',
      '@keyframes maTwinkle{from{opacity:.35;transform:scale(.85)}to{opacity:1;transform:scale(1.2)}}',
      '@keyframes maLanternPulse{from{opacity:.65}to{opacity:1}}',
      '@media (prefers-reduced-motion:reduce){.ma-flake,.ma-flake--svg svg,.ma-sleigh-wrap,.ma-reindeer-leg-a,.ma-reindeer-leg-b,.ma-star-twinkle,.ma-lantern-glow{animation:none}.ma-flake,.ma-sleigh-wrap{display:none}}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function sleighMarkup() {
    return [
      '<div class="ma-sleigh-wrap" id="maHolidaySleigh" title="Click Santa!">',
      '  <div class="ma-sleigh-bubble" id="maHolidayBubble">Ho ho ho!</div>',
      '  <svg viewBox="0 0 320 104" width="310" height="104" fill="none" xmlns="http://www.w3.org/2000/svg">',
      '    <defs>',
      '      <linearGradient id="maSleighBody" x1="34" y1="38" x2="122" y2="70" gradientUnits="userSpaceOnUse">',
      '        <stop offset="0%" stop-color="#D42E14"/><stop offset="55%" stop-color="#B8260F"/><stop offset="100%" stop-color="#7E1607"/>',
      '      </linearGradient>',
      '      <linearGradient id="maGoldTrim" x1="20" y1="30" x2="132" y2="76" gradientUnits="userSpaceOnUse">',
      '        <stop offset="0%" stop-color="#FFE08A"/><stop offset="50%" stop-color="#E5A93C"/><stop offset="100%" stop-color="#B57614"/>',
      '      </linearGradient>',
      '      <radialGradient id="maLanternHalo" cx="50%" cy="50%" r="50%">',
      '        <stop offset="0%" stop-color="#FFF3B0" stop-opacity="0.95"/><stop offset="55%" stop-color="#FFC857" stop-opacity="0.35"/><stop offset="100%" stop-color="#FFC857" stop-opacity="0"/>',
      '      </radialGradient>',
      '    </defs>',
      '    <path d="M6 70 Q52 66 96 58" stroke="#FFC857" stroke-width="1.6" stroke-dasharray="3 4" opacity="0.8"/>',
      '    <circle cx="18" cy="67" r="1.5" fill="#FFF4E0" opacity="0.85"/>',
      '    <circle cx="38" cy="64" r="2" fill="#FFC857" opacity="0.9"/>',
      '    <circle cx="62" cy="61" r="1.4" fill="#FFF4E0" opacity="0.8"/>',
      '    <polygon class="ma-star-twinkle" points="26,18 28.2,23.2 33.8,23.6 29.4,27.2 30.8,32.8 26,29.7 21.2,32.8 22.6,27.2 18.2,23.6 23.8,23.2" fill="#FFC857"/>',
      '    <polygon class="ma-star-twinkle" points="142,10 143.6,13.8 147.6,14.1 144.5,16.7 145.5,20.7 142,18.5 138.5,20.7 139.5,16.7 136.4,14.1 140.4,13.8" fill="#FFC857"/>',
      '    <polygon class="ma-star-twinkle" points="282,14 283.8,18.2 288.2,18.5 284.8,21.4 285.9,25.8 282,23.4 278.1,25.8 279.2,21.4 275.8,18.5 280.2,18.2" fill="#FFC857"/>',
      '    <path d="M126 44 L198 40 L262 33" stroke="#FFE08A" stroke-width="1.5" stroke-dasharray="4 2"/>',
      '    <path d="M198 40 L204 49 M262 33 L268 42" stroke="#D99B26" stroke-width="1.4"/>',
      '    <g>',
      '      <g class="ma-reindeer-leg-b"><path d="M258 51 L254 66 M271 51 L276 65" stroke="#5C2E14" stroke-width="2.8" stroke-linecap="round"/><circle cx="254" cy="66.5" r="1.4" fill="#3A1F10"/><circle cx="276" cy="65.5" r="1.4" fill="#3A1F10"/></g>',
      '      <g class="ma-reindeer-leg-a"><path d="M261 51 L265 66 M269 51 L266 64" stroke="#8C4B27" stroke-width="2.5" stroke-linecap="round"/><circle cx="265" cy="66.5" r="1.3" fill="#3A1F10"/><circle cx="266" cy="64.5" r="1.3" fill="#3A1F10"/></g>',
      '      <path d="M254 45 L249 43 L251 48 Z" fill="#FFF4E0" stroke="#5C2E14" stroke-width="1"/>',
      '      <ellipse cx="265" cy="46" rx="12" ry="7" fill="#8C4B27" stroke="#42200D" stroke-width="1.6"/>',
      '      <path d="M273 43 L282 30 L291 29" stroke="#8C4B27" stroke-width="5.6" stroke-linecap="round" stroke-linejoin="round"/>',
      '      <ellipse cx="288" cy="30" rx="5.5" ry="3.6" fill="#8C4B27" stroke="#42200D" stroke-width="1.4"/>',
      '      <path d="M274 41 L279 44" stroke="#B8260F" stroke-width="2.4" stroke-linecap="round"/><circle cx="277" cy="45" r="1.8" fill="#FFC857"/>',
      '      <path d="M281 29 L278 17 M281 24 L274 21 M279 20 L276 15 M285 29 L288 17 M285 24 L292 21 M287 20 L290 15" stroke="#542B13" stroke-width="2.1" stroke-linecap="round"/>',
      '      <circle cx="288" cy="28.5" r="1.2" fill="#2A1408"/>',
      '      <circle class="ma-lantern-glow" cx="294" cy="30" r="5.5" fill="url(#maLanternHalo)"/>',
      '      <circle cx="293.5" cy="30" r="3" fill="#FF2A14"/><circle cx="294.5" cy="29" r="1" fill="#FFD1C9"/>',
      '    </g>',
      '    <g>',
      '      <g class="ma-reindeer-leg-a"><path d="M206 53 L201 69 M220 53 L226 68" stroke="#5C2E14" stroke-width="3" stroke-linecap="round"/><circle cx="201" cy="69.5" r="1.5" fill="#3A1F10"/><circle cx="226" cy="68.5" r="1.5" fill="#3A1F10"/></g>',
      '      <g class="ma-reindeer-leg-b"><path d="M209 53 L214 69 M218 53 L214 67" stroke="#9E5730" stroke-width="2.7" stroke-linecap="round"/><circle cx="214" cy="69.5" r="1.4" fill="#3A1F10"/><circle cx="214" cy="67.5" r="1.4" fill="#3A1F10"/></g>',
      '      <path d="M201 47 L196 45 L198 50 Z" fill="#FFF4E0" stroke="#5C2E14" stroke-width="1"/>',
      '      <ellipse cx="213" cy="48" rx="13" ry="7.5" fill="#9E5730" stroke="#42200D" stroke-width="1.6"/>',
      '      <path d="M222 44 L232 30 L241 29" stroke="#9E5730" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>',
      '      <ellipse cx="238" cy="30" rx="5.8" ry="3.8" fill="#9E5730" stroke="#42200D" stroke-width="1.4"/>',
      '      <path d="M223 42 L228 45" stroke="#2F7D3A" stroke-width="2.4" stroke-linecap="round"/><circle cx="226" cy="46" r="1.8" fill="#FFC857"/>',
      '      <path d="M231 29 L228 16 M231 24 L224 21 M229 20 L226 14 M235 29 L238 16 M235 24 L242 21 M237 20 L240 14" stroke="#542B13" stroke-width="2.2" stroke-linecap="round"/>',
      '      <circle cx="238" cy="28.5" r="1.2" fill="#2A1408"/><circle cx="243.5" cy="30" r="2.3" fill="#3A1F10"/>',
      '    </g>',
      '    <g>',
      '      <path d="M22 74 H122 C133 74 139 68 143 56" stroke="url(#maGoldTrim)" stroke-width="4.2" stroke-linecap="round"/>',
      '      <path d="M36 65 V74 M66 65 V74 M106 65 V74" stroke="#C97A1E" stroke-width="3" stroke-linecap="round"/>',
      '      <path d="M40 47 C32 38 37 25 50 25 C62 25 67 37 61 47 Z" fill="#2F7D3A" stroke="#194720" stroke-width="1.7"/>',
      '      <path d="M44 26 Q50 23 56 26" stroke="#FFC857" stroke-width="2.2" stroke-linecap="round"/>',
      '      <rect x="61" y="33" width="14" height="14" rx="1.8" fill="#FFC857" stroke="#3A1F10" stroke-width="1.5"/><path d="M68 33 V47 M61 40 H75" stroke="#B8260F" stroke-width="1.7"/>',
      '      <rect x="76" y="37" width="11" height="10" rx="1.5" fill="#FFF4E0" stroke="#3A1F10" stroke-width="1.4"/><path d="M81.5 37 V47 M76 42 H87" stroke="#2F7D3A" stroke-width="1.5"/>',
      '      <path d="M30 46 H126 C126 60 113 66 96 66 H48 C34 66 30 56 30 46 Z" fill="url(#maSleighBody)" stroke="#3A1F10" stroke-width="2"/>',
      '      <path d="M30 46 C21 44 19 36 24 31 C28 28 33 31 32 36" stroke="url(#maGoldTrim)" stroke-width="3.6" stroke-linecap="round"/>',
      '      <path d="M34 52 H122" stroke="#FFE08A" stroke-width="2.6" stroke-linecap="round"/><path d="M44 58 C62 54 90 54 110 58" stroke="#FFC857" stroke-width="1.6" stroke-linecap="round"/>',
      '      <line x1="120" y1="46" x2="120" y2="52" stroke="#3A1F10" stroke-width="1.5"/><circle class="ma-lantern-glow" cx="120" cy="56" r="7" fill="url(#maLanternHalo)"/><rect x="117.5" y="52" width="5" height="6.5" rx="1.5" fill="#FFC857" stroke="#3A1F10" stroke-width="1.2"/>',
      '      <path d="M90 46 C91 39 96 36 102 36 C108 36 112 39 113 46 Z" fill="#B8260F" stroke="#3A1F10" stroke-width="1.5"/>',
      '      <path d="M96 36 L102 44 L108 36" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round"/>',
      '      <circle cx="101" cy="29" r="6.5" fill="#FFD8B2" stroke="#3A1F10" stroke-width="1.5"/><path d="M95.5 32 C96.5 40 106.5 40 107.5 32 Z" fill="#FFFFFF" stroke="#D4C4B5" stroke-width="1"/><circle cx="103" cy="28" r="1.2" fill="#3A1F10"/>',
      '      <path d="M93 26 L102 13 L111 26 Z" fill="#B8260F" stroke="#3A1F10" stroke-width="1.5"/><path d="M92 26 H112" stroke="#FFFFFF" stroke-width="3.6" stroke-linecap="round"/><circle cx="111" cy="22" r="3" fill="#FFFFFF" stroke="#D4C4B5" stroke-width="1.1"/>',
      '    </g>',
      '  </svg>',
      '</div>'
    ].join('\n');
  }

  function detailedFlakeSVG(variant) {
    if (variant === 0) {
      return '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
        + '<line x1="16" y1="3" x2="16" y2="29"/><line x1="4.7" y1="9.5" x2="27.3" y2="22.5"/><line x1="27.3" y1="9.5" x2="4.7" y2="22.5"/>'
        + '<path d="M13 6.5 L16 9.5 L19 6.5 M13 25.5 L16 22.5 L19 25.5"/>'
        + '<path d="M7.5 8 L11 11.2 L7.2 13.5 M24.5 24 L21 20.8 L24.8 18.5"/>'
        + '<path d="M24.8 13.5 L21 11.2 L24.5 8 M7.2 18.5 L11 20.8 L7.5 24"/>'
        + '<circle cx="16" cy="16" r="2.2"/></svg>';
    }
    if (variant === 1) {
      return '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'
        + '<path d="M16 2 V30 M3.9 9 L28.1 23 M28.1 9 L3.9 23"/>'
        + '<polygon points="16,10 21.2,13 21.2,19 16,22 10.8,19 10.8,13"/>'
        + '<path d="M12.5 5.5 L16 8.5 L19.5 5.5 M12.5 26.5 L16 23.5 L19.5 26.5"/>'
        + '<circle cx="16" cy="16" r="1.6" fill="currentColor"/></svg>';
    }
    return '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">'
      + '<line x1="16" y1="4" x2="16" y2="28"/><line x1="5.6" y1="10" x2="26.4" y2="22"/><line x1="26.4" y1="10" x2="5.6" y2="22"/>'
      + '<circle cx="16" cy="4" r="1.5" fill="currentColor"/><circle cx="16" cy="28" r="1.5" fill="currentColor"/>'
      + '<circle cx="5.6" cy="10" r="1.5" fill="currentColor"/><circle cx="26.4" cy="22" r="1.5" fill="currentColor"/>'
      + '<circle cx="26.4" cy="10" r="1.5" fill="currentColor"/><circle cx="5.6" cy="22" r="1.5" fill="currentColor"/>'
      + '<circle cx="16" cy="16" r="2"/></svg>';
  }

  function ensureLayer() {
    injectStyles();
    var layer = $('maHolidayLayer');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'maHolidayLayer';
      layer.className = 'ma-holiday-layer';
      layer.setAttribute('aria-hidden', 'true');
      layer.innerHTML = sleighMarkup();
      document.body.appendChild(layer);
    }
    return layer;
  }

  function clearFlakes(layer) {
    var flakes = layer.querySelectorAll('.ma-flake');
    for (var i = 0; i < flakes.length; i++) {
      flakes[i].parentNode.removeChild(flakes[i]);
    }
  }

  function buildSnow(layer, density, speed) {
    clearFlakes(layer);
    if (density <= 0) return;
    var count = Math.round(density * 0.9);
    for (var i = 0; i < count; i++) {
      var useSvg = (i % 3 === 0);
      var flake = document.createElement('span');
      var dur = (8 + rnd(8)) / speed;
      var drift = ((rnd(2) ? 1 : -1) * (10 + rnd(20))) + 'px';
      flake.style.left = ((i * (100 / count)) + rnd(4)) + '%';
      flake.style.setProperty('--drift', drift);
      flake.style.animationDuration = dur.toFixed(2) + 's';
      flake.style.animationDelay = '-' + (rnd(120) / 10).toFixed(1) + 's';
      if (useSvg) {
        var sz = 14 + rnd(13);
        flake.className = 'ma-flake ma-flake--svg';
        flake.style.width = sz + 'px';
        flake.style.height = sz + 'px';
        flake.style.opacity = (0.65 + rnd(30) / 100).toFixed(2);
        flake.style.setProperty('--spin-dur', ((7 + rnd(9)) / speed).toFixed(2) + 's');
        flake.innerHTML = detailedFlakeSVG(i % 3);
      } else {
        var ds = 3 + rnd(5);
        flake.className = 'ma-flake ma-flake--dot';
        flake.style.width = ds + 'px';
        flake.style.height = ds + 'px';
        flake.style.opacity = (0.55 + rnd(40) / 100).toFixed(2);
      }
      layer.appendChild(flake);
    }
  }

  function pickNextPath() {
    var paths = [
      { baseY: 74, ampY: 22, waves: 1, tilt: 3 },
      { baseY: 96, ampY: 26, waves: 2, tilt: 4 },
      { baseY: 118, ampY: -24, waves: 1, tilt: 3.5 }
    ];
    sleighPath = paths[rnd(paths.length)];
  }

  function stepSleigh(now) {
    if (lastFrameTime === null) lastFrameTime = now;
    var dt = Math.min(0.1, (now - lastFrameTime) / 1000);
    lastFrameTime = now;

    var sleigh = $('maHolidaySleigh');
    if (sleigh && sleighActive) {
      var duration = 22 / sleighSpeedMult;
      sleighProgress += dt / duration;
      if (sleighProgress > 1) {
        sleighProgress -= 1;
        pickNextPath();
      }
      var startX = -330;
      var endX = (window.innerWidth || 1280) + 60;
      var x = startX + (endX - startX) * sleighProgress;
      var angle = Math.PI * sleighPath.waves * sleighProgress;
      var y = sleighPath.baseY - Math.sin(angle) * sleighPath.ampY;
      var rot = -Math.cos(angle) * sleighPath.tilt;
      sleigh.style.transform = 'translate3d(' + x.toFixed(1) + 'px, ' + y.toFixed(1) + 'px, 0) rotate(' + rot.toFixed(2) + 'deg)';
    }
    requestAnimationFrame(stepSleigh);
  }

  function fallbackChime() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      var c = new AC();
      [587.33, 659.25, 783.99].forEach(function (freq, i) {
        var o = c.createOscillator();
        var g = c.createGain();
        o.type = 'sine';
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.05, c.currentTime + i * 0.11);
        g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + i * 0.11 + 0.16);
        o.connect(g);
        g.connect(c.destination);
        o.start(c.currentTime + i * 0.11);
        o.stop(c.currentTime + i * 0.11 + 0.18);
      });
    } catch (e) {}
  }

  function speakSantaLine(phrase) {
    var av = window.AgencyVoice || window.voiceSynthesizer || window.VoiceSynthesizer;
    if (av) {
      if (typeof av.speak === 'function') {
        try {
          av.speak('santa', phrase, phrase);
          return;
        } catch (e) {}
        try {
          av.speak(phrase, { pitch: 0.78, rate: 0.92, character: 'santa' });
          return;
        } catch (e2) {}
      }
      if (typeof av.say === 'function') {
        try {
          av.say(phrase);
          return;
        } catch (e3) {}
      }
    }
    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
        var utter = new SpeechSynthesisUtterance(phrase);
        utter.pitch = 0.78;
        utter.rate = 0.92;
        window.speechSynthesis.speak(utter);
        return;
      } catch (e4) {}
    }
    fallbackChime();
  }

  function applySettings(cfg) {
    var current = cfg || readConfig();
    var layer = ensureLayer();
    sleighActive = !!current.christmasEnabled;
    sleighSpeedMult = current.snowSpeed;
    document.body.classList.toggle('ma-holiday-active', sleighActive);
    buildSnow(layer, sleighActive ? current.snowDensity : 0, sleighSpeedMult);
  }

  function init() {
    var layer = ensureLayer();
    var sleigh = $('maHolidaySleigh');
    var bubble = $('maHolidayBubble');
    if (sleigh) {
      sleigh.addEventListener('click', function (e) {
        e.stopPropagation();
        var phrase = SANTA_LINES[greetingIdx % SANTA_LINES.length];
        greetingIdx += 1;
        if (bubble) bubble.textContent = phrase;
        sleigh.classList.add('ma-speaking');
        speakSantaLine(phrase);
        if (hohoTimer) clearTimeout(hohoTimer);
        hohoTimer = setTimeout(function () {
          sleigh.classList.remove('ma-speaking');
        }, 1800);
      });
    }
    applySettings(readConfig());
    requestAnimationFrame(stepSleigh);
    window.addEventListener('storage', function (e) {
      if (e.key === STORAGE_KEY) applySettings(readConfig());
    });
    window.addEventListener(EVENT_NAME, function (e) {
      applySettings((e && e.detail) || readConfig());
    });
    var api = {
      apply: applySettings,
      read: readConfig
    };
    window.HolidayOverlay = api;
    window.MidnightAgencyOverlay = api;
    void layer;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();