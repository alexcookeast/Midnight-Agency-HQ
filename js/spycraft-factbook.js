(function (global) {
  "use strict";

  var CATEGORIES = [
    { id: "all", label: "All Field Notes" },
    { id: "ciphers", label: "Ciphers & Secret Codes" },
    { id: "tradecraft", label: "Spy Tradecraft" },
    { id: "syndicates", label: "Syndicate Intelligence" },
    { id: "countries", label: "Countries & Regions" }
  ];

  // Country entries are registered from data/factbook-index.json (registerCountryIndex) so the map can
  // open a country by iso2. They live apart from ENTRIES so "all" stays the spycraft field notes.
  var COUNTRY_ENTRIES = [];
  var COUNTRY_BY_ISO2 = {};

  var ENTRIES = [
    {
      id: "caesar-shift",
      category: "ciphers",
      title: "Caesar Shift Cipher",
      summary: "Shifts every letter along the alphabet by a secret number of steps.",
      origin: "Named after Roman general Julius Caesar, who used small shifts to protect field dispatches.",
      howItWorks: "Pick a shift number like +3. Count forward 3 letters in the alphabet (A -> D, B -> E), looping past Z back to A. To decode, count backward the same number of steps.",
      steps: [
        "Write out A through Z so you can point to each letter.",
        "Pick your secret shift (for example, +3 or -2).",
        "Swap each letter for the one that many steps away."
      ],
      example: {
        plain: "PIZZA AT DOCK",
        cipher: "SLCCD DW GRFN",
        key: "Shift +3"
      },
      drill: {
        prompt: "Decode 'KHOOR' using a shift of -3.",
        hint: "K is 3 letters after H; H is 3 after E...",
        answer: "HELLO"
      },
      tip: "Because there are only 25 non-zero shifts in English, testing shifts 1 to 5 often cracks short messages fast.",
      tags: ["caesar", "shift", "rot", "substitution", "beginner"],
      labHook: "cipher"
    },
    {
      id: "atbash-keyword",
      category: "ciphers",
      title: "Atbash & Keyword Substitution",
      summary: "Replaces the normal A–Z order with a mirrored or secret-word alphabet.",
      origin: "Atbash dates back to ancient Hebrew script (pairing first and last letters), while keyword alphabets became a staple of classic spycraft.",
      howItWorks: "Atbash flips the alphabet backward (A <-> Z, B <-> Y, C <-> X). A keyword cipher starts with a secret code word—removing any repeated letters—and then fills in the remaining letters in order.",
      steps: [
        "Choose a secret keyword with no duplicate letters (such as CIPHER).",
        "Write C-I-P-H-E-R first on your cipher strip.",
        "Follow with the remaining letters of the alphabet in normal order (A, B, D, F, G...)."
      ],
      example: {
        plain: "MAP",
        cipher: "NZK",
        key: "Atbash (A<->Z)"
      },
      drill: {
        prompt: "In Atbash, what does 'ZOO' turn into?",
        hint: "Flip Z to A, and O to L.",
        answer: "ALL"
      },
      tip: "Keyword alphabets scramble the start of the alphabet while keeping the tail predictable—great for spotting patterns.",
      tags: ["atbash", "keyword", "substitution", "alphabet"],
      labHook: "cipher"
    },
    {
      id: "pigpen-grid",
      category: "ciphers",
      title: "Pigpen (Masonic) Cipher",
      summary: "Turns letters into geometric tic-tac-toe and X shapes, often with dots.",
      origin: "Used in secret fraternal groups and spy notes because it looks like mysterious symbols rather than ordinary words.",
      howItWorks: "Draw two '#' tic-tac-toe grids and two big 'X' shapes. Each pocket holds letters, and a dot inside the shape tells you which set of letters it belongs to.",
      steps: [
        "Picture a '#' grid for the first set of letters and an 'X' for the next.",
        "Copy the lines forming the pocket around your target letter.",
        "Add a center dot if the letter sits in the dotted companion set."
      ],
      example: {
        plain: "SPY",
        cipher: "Corner/box marks + X-pocket symbol",
        key: "Pigpen Grid"
      },
      drill: {
        prompt: "Why do spies like Pigpen notes?",
        hint: "Think about how someone glances at a scrap of paper.",
        answer: "They look like doodles or map marks instead of hidden text."
      },
      tip: "Look closely at whether a symbol has a dot—one tiny dot changes the letter.",
      tags: ["pigpen", "grid", "symbols", "visual", "substitution"],
      labHook: "cipher"
    },
    {
      id: "vigenere-key",
      category: "ciphers",
      title: "Vigenere Key Cipher",
      summary: "Uses a repeating secret word so the same letter can be encoded in different ways.",
      origin: "Formalized in the 1500s and long prized because repeating letters like 'EE' or 'LL' no longer give away easy patterns.",
      howItWorks: "Write your message on top and repeat a short keyword underneath letter by letter. Each keyword letter sets a different shift amount for the letter above it.",
      steps: [
        "Pick a short keyword (like KEY) and repeat it under your message.",
        "Find how far the keyword letter sits past A (A=0, B=1, C=2... K=10).",
        "Shift the message letter forward by that amount."
      ],
      example: {
        plain: "MEET",
        cipher: "WIDX",
        key: "Keyword: KEY"
      },
      drill: {
        prompt: "If 'A' shifts by 0, what happens when a keyword letter is 'A'?",
        hint: "Moving 0 steps leaves the letter where it started.",
        answer: "The letter stays unchanged for that position."
      },
      tip: "Unlike Caesar ciphers, two identical letters in a row can become two completely different characters.",
      tags: ["vigenere", "polyalphabetic", "keyword", "cipher"],
      labHook: "cipher"
    },
    {
      id: "rail-fence",
      category: "ciphers",
      title: "Rail Fence (Zig-Zag) Transposition",
      summary: "Keeps the exact same letters, but zig-zags their order across rows.",
      origin: "Transposition ciphers were used in war and espionage to rearrange letter order when alphabet swaps alone might be guessed.",
      howItWorks: "Instead of changing letters into other letters, write them diagonally down and up across 2 or 3 'rails' (rows), then read each row left-to-right to build the secret string.",
      steps: [
        "Draw 2 or 3 horizontal lines (rails).",
        "Write your message diagonally down to the bottom rail, then back up to the top.",
        "Read across row 1, then row 2, then row 3."
      ],
      example: {
        plain: "SECRET TRAIL",
        cipher: "SRTAL ECRTIL",
        key: "2 Rails"
      },
      drill: {
        prompt: "Does a Rail Fence cipher change the count of each letter in the message?",
        hint: "Did we swap any letters or invent new ones?",
        answer: "No—every original letter is still there, just reordered."
      },
      tip: "If a coded message has the exact letter counts of normal English but looks scrambled, try transposition.",
      tags: ["rail-fence", "transposition", "zig-zag", "cipher"],
      labHook: "cipher"
    },
    {
      id: "codebooks-stego",
      category: "ciphers",
      title: "Codebooks & Steganography",
      summary: "Swaps whole words or places for code names, or hides secrets inside normal things.",
      origin: "Diplomatic couriers and spies have used codebooks and hidden-in-plain-sight tricks for centuries.",
      howItWorks: "A codebook assigns secret meanings to whole words or locations (such as 'DEEP DISH = harbor pier'). Steganography hides the message itself inside an everyday format—like taking the first letter of each line or word.",
      steps: [
        "Decide whether you are replacing whole words/places (codebook) or hiding inside text (steganography).",
        "Keep cover messages sounding natural so they do not draw suspicion.",
        "Check first letters, capital letters, or agreed code words when decoding."
      ],
      example: {
        plain: "Meet at Pier 9 at midnight",
        cipher: "Order the Midnight Special at Dock Nine",
        key: "Codebook / Cover Phrase"
      },
      drill: {
        prompt: "What is an acrostic trick in steganography?",
        hint: "Look at the beginning of each line or sentence.",
        answer: "Reading the first letter of each line or word spells a hidden message."
      },
      tip: "A cipher hides meaning by scrambling; steganography hides the fact that there is a secret message at all.",
      tags: ["codebook", "steganography", "acrostic", "cover", "deduction"],
      labHook: "deduction"
    },
    {
      id: "dead-drops",
      category: "tradecraft",
      title: "Dead Drops, Brush Passes & Cover Fronts",
      summary: "How agents pass clues or stay undercover without giving away their HQ.",
      origin: "Classic espionage relies on timing, separation, and ordinary cover stories so one slip does not expose the whole network.",
      howItWorks: "A dead drop leaves information at an agreed spot for someone else to pick up later without meeting face-to-face. A cover front—like a busy pizza parlour—gives people a normal reason to be there.",
      steps: [
        "Never link a secret drop directly to your headquarters or home base.",
        "Keep cover stories simple, consistent, and believable.",
        "Watch who visits a spot and when—timing is often the biggest clue."
      ],
      example: {
        plain: "Passing an agency briefing",
        cipher: "Pizza order code + timed pickup",
        key: "Cover Front & Dead Drop"
      },
      drill: {
        prompt: "Why avoid meeting in person for every handoff?",
        hint: "Think about being watched or followed.",
        answer: "Face-to-face meetings can connect two people who are being watched."
      },
      tip: "Good tradecraft is quiet: if everyone acts normal, nobody notices the handoff.",
      tags: ["dead-drop", "cover", "tradecraft", "fieldcraft"],
      labHook: "fieldcraft"
    },
    {
      id: "corroboration-routes",
      category: "tradecraft",
      title: "Corroborating Clues & Reading Routes",
      summary: "Matching independent clues against maps, travel modes, and timelines.",
      origin: "Great detectives—from classic armchair sleuths to modern intelligence analysts—verify leads rather than guessing off one hint.",
      howItWorks: "One clue might be a coincidence or a bad rumor, while two or three matching clues lock in a pattern. Checking geography, ports, rail lines, and travel times tells you where a suspect can realistically go next.",
      steps: [
        "Gather more than one clue before locking in a suspect or destination.",
        "Check geography and travel modes—could someone actually reach that city in time?",
        "Watch out for non-syndicate mix-ups like grumpy locals or plain accidents."
      ],
      example: {
        plain: "Winter boots + night rail note",
        cipher: "Cold northern route toward a rail hub",
        key: "Clue Corroboration"
      },
      drill: {
        prompt: "What should you do if a clue points one way but a timing clue does not fit?",
        hint: "Don't rush a bad warrant.",
        answer: "Double-check your clues and look for another lead before making an arrest."
      },
      tip: "A single clue starts a hunch; matching clues build a case.",
      tags: ["clues", "routes", "geography", "deduction", "fieldcraft"],
      labHook: "deduction"
    },
    {
      id: "syndicate-tiers",
      category: "syndicates",
      title: "How Syndicate Rings Are Structured (Tiers 1–5)",
      summary: "Crime rings use rank ladders and regional styles to protect their leaders.",
      origin: "Real-world syndicates vary by history and region, but most separate street-level workers from middle managers and top bosses.",
      howItWorks: "In the agency's 5-tier model, Tier 1 covers street runners or initiates, Tiers 2–4 cover crew members, specialists, and lieutenants, and Tier 5 is the syndicate head. Different crews and regions use distinct titles for those same tiers.",
      steps: [
        "Check the ring's archetype and region to understand its rank titles.",
        "Nabbing lower-tier operatives uncovers intel that points up the chain.",
        "Track patterns across a ring's hubs and tactics to expose the boss."
      ],
      example: {
        plain: "Tier 1 -> Tier 3 -> Tier 5",
        cipher: "Runner -> Lieutenant -> Kingpin",
        key: "5-Tier Syndicate Ladder"
      },
      drill: {
        prompt: "Why do bosses stay hidden early in a syndicate investigation?",
        hint: "Leaders try to stay behind middle ranks.",
        answer: "They rely on lower and middle tiers to take the risks and run operations."
      },
      tip: "Even when two rings use different rank names, their internal tier tells you how high up the ladder you are.",
      tags: ["syndicate", "ranks", "tiers", "cartel", "mob", "triad", "yakuza", "smugglers"],
      labHook: "deduction"
    }
  ];

  function getCategories() {
    return CATEGORIES.slice();
  }

  function getEntries(categoryId) {
    if (categoryId === "countries") return COUNTRY_ENTRIES.slice();
    if (!categoryId || categoryId === "all") return ENTRIES.slice();
    return ENTRIES.filter(function (item) {
      return item.category === categoryId;
    });
  }

  // index: factbook-index.json ({countries:{AF:{...}}} or array of [iso2, record] / records)
  function registerCountryIndex(index) {
    var list = index && index.countries ? index.countries : index;
    var rows = Array.isArray(list) ? list : Object.keys(list || {}).map(function (k) { return [k, list[k]]; });
    COUNTRY_ENTRIES.length = 0; COUNTRY_BY_ISO2 = {};
    rows.forEach(function (row) {
      var rec = Array.isArray(row) ? row[1] : row;
      if (!rec || !rec.iso2) return;
      var entry = {
        id: "country-" + rec.iso2.toLowerCase(), category: "countries", iso2: rec.iso2, title: rec.name,
        summary: [rec.subregion || rec.region, rec.capital && rec.capital.name ? "Capital: " + rec.capital.name : ""].filter(Boolean).join(" · "),
        region: rec.region, subregion: rec.subregion, flagPath: rec.flagPath, dataUrl: "data/countries/" + rec.iso2.toLowerCase() + ".json",
        tags: rec.clueTags || []
      };
      COUNTRY_ENTRIES.push(entry); COUNTRY_BY_ISO2[rec.iso2.toUpperCase()] = entry;
    });
    COUNTRY_ENTRIES.sort(function (a, b) { return a.title < b.title ? -1 : 1; });
    return COUNTRY_ENTRIES.length;
  }

  function findCountry(iso2) {
    return COUNTRY_BY_ISO2[String(iso2 || "").toUpperCase()] || null;
  }

  function findEntry(id) {
    if (String(id).indexOf("country-") === 0) return findCountry(String(id).slice(8));
    for (var i = 0; i < ENTRIES.length; i += 1) {
      if (ENTRIES[i].id === id) return ENTRIES[i];
    }
    return null;
  }

  function searchEntries(query) {
    var q = String(query || "").trim().toLowerCase();
    if (!q) return ENTRIES.slice();
    return ENTRIES.filter(function (item) {
      var stepText = Array.isArray(item.steps) ? item.steps.join(" ") : "";
      var tagText = Array.isArray(item.tags) ? item.tags.join(" ") : "";
      var exText = item.example
        ? [item.example.plain, item.example.cipher, item.example.key].join(" ")
        : "";
      var drillText = item.drill
        ? [item.drill.prompt, item.drill.hint, item.drill.answer].join(" ")
        : "";
      var hay = [
        item.title,
        item.summary,
        item.origin,
        item.howItWorks,
        stepText,
        exText,
        drillText,
        item.tip,
        tagText,
        item.category
      ].join(" ").toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }

  function registerEntry(entry) {
    if (!entry || !entry.id || !entry.title) return null;
    for (var i = 0; i < ENTRIES.length; i += 1) {
      if (ENTRIES[i].id === entry.id) {
        ENTRIES[i] = Object.assign({}, ENTRIES[i], entry);
        return ENTRIES[i];
      }
    }
    ENTRIES.push(entry);
    return entry;
  }

  function registerEntries(list) {
    if (!Array.isArray(list)) return [];
    return list.map(registerEntry).filter(Boolean);
  }

  global.SpycraftFactbook = {
    CATEGORIES: CATEGORIES,
    ENTRIES: ENTRIES,
    getCategories: getCategories,
    getEntries: getEntries,
    findEntry: findEntry,
    searchEntries: searchEntries,
    registerEntry: registerEntry,
    registerEntries: registerEntries,
    registerCountryIndex: registerCountryIndex,
    findCountry: findCountry,
    getCountries: function () { return COUNTRY_ENTRIES.slice(); }
  };
})(typeof window !== "undefined" ? window : globalThis);