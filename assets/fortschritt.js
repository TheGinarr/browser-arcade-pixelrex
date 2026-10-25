/* ============================================================
   fortschritt.js · Spielübergreifender Fortschritt (nur lokal)

   - Erfahrungspunkte (EP) + Spieler-Level über alle Spiele
   - 3 Tagesaufgaben (für alle gleich, aus dem Datum gewürfelt),
     Belohnung EP (keine Währung, keine Gegenstände). Serie = Tage mit
     erledigter Aufgabe, bis zu 2 Tage Pause verzeiht sie; Serienbonus
     auf alle EP (+10 % je Tag, max. +100 %).
   - Abzeichen Bronze/Silber/Gold je Spiel (aus den eigenen
     Bestwerten, wirkt also auch rückwirkend) + allgemeine
   - "Zuletzt gespielt" für die Startseite

   Alles liegt in localStorage ba:fortschritt:daten – nichts geht
   an den Server. Ereignisse kommen aus ui.js (gameOverDialog),
   wallet.js (Casino-Runde) und den Level-Spielen (levelGeschafft).
   Keine Abhängigkeit zu wallet.js/ui.js (sonst Import-Kreis).
   ============================================================ */

import { lade, speichere } from "./storage.js";

const S = "fortschritt";
const BELOHNUNG = { ep: 40 };
const BONUS = { ep: 100 };
const EP_RUNDE = 10,
  EP_REKORD = 15,
  EP_RUNDEN_TAG = 300;
const zahl = (n) => Number(n).toLocaleString("de-DE");

/* ---------- Spiele ---------- */
// Arcade-Spiele mit "Runden" (Tagesaufgaben) + Punkte-Ziel für eine Runde
const ARCADE = {
  snake: ["Snake", 150],
  pixelrex: ["Pixelrex", 300],
  flattervogel: ["Flattervogel", 8],
  froschsprung: ["Froschsprung", 500],
  mauerbrecher: ["Mauerbrecher", 1500],
  meteorsturm: ["Meteorsturm", 2500],
  2048: ["2048", 2000],
  wortfuchs: ["Wortfuchs", 3],
};
const LEVELSPIELE = {
  waesche: "Wäsche",
  regale: "Regale",
  gewuerze: "Gewürze",
  zuckerzauber: "Zuckerzauber",
};

const pb = (id) => lade("konto", `pb:${id}`, null);
const sterneSumme = (spiel) =>
  Object.values(lade(spiel, "sterne", {}) || {}).reduce((a, b) => a + (Number(b) || 0), 0);
const zzSterne = () =>
  Object.values(lade("zuckerzauber", "best", {}) || {}).reduce((a, b) => a + (b?.st || 0), 0);

/* Abzeichen je Spiel: wert() = aktueller Stand (höher = besser), stufen = Bronze/Silber/Gold.
   Bei "Zeit"-Spielen (weniger ist besser) wird der Stand in Stufen 0–3 übersetzt. */
const hoch = (id) => () => pb(id) || 0;
const runter = (ids) => () => ids.reduce((s, id, i) => (pb(id) ? i + 1 : s), 0); // höchste geschaffte Schwierigkeit
export const SPIEL_ABZ = [
  { id: "snake", name: "Snake", wert: hoch("snake"), stufen: [100, 300, 600], einheit: "Punkte" },
  {
    id: "pixelrex",
    name: "Pixelrex",
    wert: hoch("pixelrex"),
    stufen: [200, 500, 1000],
    einheit: "Punkte",
  },
  {
    id: "flattervogel",
    name: "Flattervogel",
    wert: hoch("flattervogel"),
    stufen: [5, 15, 30],
    einheit: "Röhren",
  },
  {
    id: "froschsprung",
    name: "Froschsprung",
    wert: hoch("froschsprung"),
    stufen: [300, 1000, 2500],
    einheit: "Punkte",
  },
  {
    id: "mauerbrecher",
    name: "Mauerbrecher",
    wert: hoch("mauerbrecher"),
    stufen: [1000, 3000, 8000],
    einheit: "Punkte",
  },
  {
    id: "meteorsturm",
    name: "Meteorsturm",
    wert: hoch("meteorsturm"),
    stufen: [2000, 5000, 10000],
    einheit: "Punkte",
  },
  { id: "2048", name: "2048", wert: hoch("2048"), stufen: [2000, 8000, 20000], einheit: "Punkte" },
  {
    id: "minesweeper",
    name: "Minesweeper",
    wert: runter(["minesweeper-leicht", "minesweeper-mittel", "minesweeper-schwer"]),
    stufen: [1, 2, 3],
    text: ["Leicht gelöst", "Mittel gelöst", "Schwer gelöst"],
  },
  {
    id: "sudoku",
    name: "Sudoku",
    wert: runter(["sudoku-leicht", "sudoku-mittel", "sudoku-schwer"]),
    stufen: [1, 2, 3],
    text: ["Leicht gelöst", "Mittel gelöst", "Schwer gelöst"],
  },
  {
    id: "waesche",
    name: "Wäsche",
    wert: () => sterneSumme("waesche"),
    stufen: [30, 90, 150],
    einheit: "Sterne",
  },
  {
    id: "regale",
    name: "Regale",
    wert: () => sterneSumme("regale"),
    stufen: [30, 90, 150],
    einheit: "Sterne",
  },
  {
    id: "gewuerze",
    name: "Gewürze",
    wert: () => sterneSumme("gewuerze"),
    stufen: [30, 90, 150],
    einheit: "Sterne",
  },
  {
    id: "zuckerzauber",
    name: "Zuckerzauber",
    wert: zzSterne,
    stufen: [50, 200, 400],
    einheit: "Sterne",
  },
  {
    id: "solitaer",
    name: "Solitär",
    wert: () => {
      const t = Math.min(pb("solitaer-1") || 1e9, pb("solitaer-3") || 1e9);
      return t >= 1e9 ? 0 : t < 300 ? 3 : t < 600 ? 2 : 1;
    },
    stufen: [1, 2, 3],
    text: ["Eine Partie gelöst", "Unter 10 Minuten", "Unter 5 Minuten"],
  },
  {
    id: "wortfuchs",
    name: "Wortfuchs",
    wert: hoch("wortfuchs"),
    stufen: [3, 7, 15],
    einheit: "Siege in Serie",
  },
  {
    id: "zahlenraten",
    name: "Zahlenraten",
    wert: () => {
      const v = pb("zahlenraten");
      return !v ? 0 : v <= 5 ? 3 : v <= 7 ? 2 : 1;
    },
    stufen: [1, 2, 3],
    text: ["Zahl erraten", "In 7 Versuchen", "In 5 Versuchen"],
  },
  {
    id: "higher-lower",
    name: "Higher Lower",
    wert: hoch("higher-lower"),
    stufen: [5, 10, 20],
    einheit: "richtig in Folge",
  },
  {
    id: "viererreihe",
    name: "Viererreihe",
    wert: hoch("viererreihe"),
    stufen: [1, 3, 5],
    einheit: "Siege in Serie (Schwer)",
  },
  { id: "schach", name: "Schach", wert: hoch("schach"), stufen: [1, 10, 50], einheit: "Punkte" },
  { id: "ludo", name: "Ludo", wert: hoch("ludo"), stufen: [1, 10, 50], einheit: "Punkte" },
  {
    id: "coinflip",
    name: "Coinflip",
    wert: hoch("coinflip"),
    stufen: [4, 7, 10],
    einheit: "richtig in Folge",
  },
];
const STUFEN = ["Bronze", "Silber", "Gold"];

/* ---------- Speicher ---------- */
function daten() {
  const d = lade(S, "daten", null);
  if (d && typeof d === "object") return d;
  return {
    ep: 0,
    serie: { tage: 0, letzter: null, beste: 0 },
    aufgaben: 0,
    zuletzt: [],
    abz: null,
    tag: null,
  };
}
const sichern = (d) => speichere(S, "daten", d);

export function heute(dt = new Date()) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}
const tageZwischen = (a, b) =>
  Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 864e5);

function tagVon(d) {
  const h = heute();
  if (!d.tag || d.tag.d !== h)
    d.tag = {
      d: h,
      runden: 0,
      proSpiel: {},
      level: {},
      sterne: 0,
      spiele: [],
      fertig: [false, false, false],
      bonus: false,
      epRunden: 0,
      epCasino: 0,
    };
  return d.tag;
}

/* ---------- Spieler-Level ---------- */
export const epFuerLevel = (l) => 100 + 50 * (l - 1); // EP, um von Level l auf l+1 zu kommen
const RAENGE = [
  [1, "Neuling"],
  [3, "Gelegenheitsspieler"],
  [5, "Stammgast"],
  [8, "Könner"],
  [12, "Profi"],
  [16, "Ass"],
  [20, "Meister"],
  [30, "Legende"],
];
export const rang = (l) => RAENGE.filter(([ab]) => l >= ab).pop()[1];
export function levelAus(ep) {
  let l = 1,
    rest = ep;
  while (rest >= epFuerLevel(l)) {
    rest -= epFuerLevel(l);
    l++;
  }
  return { level: l, rest, noetig: epFuerLevel(l), anteil: rest / epFuerLevel(l), rang: rang(l) };
}

/* ---------- Tagesaufgaben ---------- */
function zufall(text) {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const wahl = (r, liste) => liste[Math.floor(r() * liste.length)];

/** Die 3 Aufgaben eines Tages – für alle gleich, ohne Server. */
export function aufgabenFuer(datum = heute()) {
  const r = zufall("ba-aufgaben-" + datum);
  const arcade = Object.keys(ARCADE),
    level = Object.keys(LEVELSPIELE);
  const bau = {
    runden: () => {
      const n = wahl(r, [3, 5, 8]);
      return { art: "runden", ziel: n, text: `Spiele ${n} Runden – egal welches Spiel` };
    },
    spielRunden: () => {
      const s = wahl(r, arcade);
      return {
        art: "spielRunden",
        spiel: s,
        ziel: 3,
        text: `Spiele 3 Runden ${ARCADE[s][0]}`,
        link: s,
      };
    },
    punkte: () => {
      const s = wahl(r, arcade);
      const p = ARCADE[s][1];
      return {
        art: "punkte",
        spiel: s,
        ziel: p,
        text:
          s === "wortfuchs"
            ? `Gewinne ${p} Wortfuchs-Runden in Folge`
            : `Schaffe ${zahl(p)} Punkte in einer Runde ${ARCADE[s][0]}`,
        link: s,
      };
    },
    level: () => {
      const s = wahl(r, level);
      const n = wahl(r, [2, 3]);
      return {
        art: "level",
        spiel: s,
        ziel: n,
        text: `Schaffe ${n} Level in ${LEVELSPIELE[s]}`,
        link: s,
      };
    },
    sterne: () => {
      const n = wahl(r, [5, 6, 8]);
      return { art: "sterne", ziel: n, text: `Sammle ${n} Sterne in Level-Spielen` };
    },
    vielfalt: () => {
      const n = wahl(r, [2, 3]);
      return { art: "vielfalt", ziel: n, text: `Spiele ${n} verschiedene Spiele` };
    },
  };
  const arten = Object.keys(bau);
  const liste = [];
  while (liste.length < 3) {
    const a = wahl(r, arten);
    if (
      liste.some((x) => x.art === a) ||
      (a === "punkte" && liste.some((x) => x.art === "spielRunden"))
    )
      continue;
    liste.push(bau[a]());
  }
  return liste;
}

function stand(a, t) {
  switch (a.art) {
    case "runden":
      return t.runden;
    case "spielRunden":
      return t.proSpiel[a.spiel]?.r || 0;
    case "punkte":
      return t.proSpiel[a.spiel]?.max || 0;
    case "level":
      return t.level[a.spiel] || 0;
    case "sterne":
      return t.sterne;
    case "vielfalt":
      return t.spiele.length;
  }
  return 0;
}

/** Für Anzeige: [{text, ziel, stand, fertig, link}] */
export function aufgabenHeute() {
  const d = daten(),
    t = tagVon(d);
  return aufgabenFuer(t.d).map((a, i) => ({
    ...a,
    stand: Math.min(a.ziel, stand(a, t)),
    fertig: !!t.fertig[i],
  }));
}

/* ---------- Belohnen ---------- */
function serieAktiv(d) {
  const s = d.serie;
  return s.letzter && tageZwischen(s.letzter, heute()) <= 3 ? s.tage : 0;
}
/** Serienbonus: +10 % EP je Serientag, höchstens +100 % */
export const serienFaktor = (tage) => 1 + Math.min(10, tage) / 10;

function auswerten(d, meldungen) {
  const t = tagVon(d);
  aufgabenFuer(t.d).forEach((a, i) => {
    if (t.fertig[i] || stand(a, t) < a.ziel) return;
    t.fertig[i] = true;
    d.aufgaben = (d.aufgaben || 0) + 1;
    d.ep += BELOHNUNG.ep;
    // Serie: erster erledigter Auftrag des Tages zählt. Bis zu 2 Tage Pause verzeiht sie.
    const s = d.serie;
    if (s.letzter !== t.d) {
      s.tage = s.letzter && tageZwischen(s.letzter, t.d) <= 3 ? s.tage + 1 : 1;
      s.letzter = t.d;
      s.beste = Math.max(s.beste || 0, s.tage);
    }
    meldungen.push({
      art: "aufgabe",
      titel: "Tagesaufgabe geschafft!",
      text: `${a.text} · +${BELOHNUNG.ep} EP${s.tage > 1 ? ` · Serie: ${s.tage} Tage` : ""}`,
    });
  });
  if (!t.bonus && t.fertig.every(Boolean)) {
    t.bonus = true;
    d.ep += BONUS.ep;
    meldungen.push({
      art: "bonus",
      titel: "Alle 3 Aufgaben erledigt!",
      text: `Tagesbonus +${BONUS.ep} EP. Morgen gibt es neue.`,
    });
  }
}

/* ---------- Abzeichen ---------- */
function abzeichenStufe(a) {
  const w = a.wert();
  return a.stufen.reduce((s, grenze, i) => (w >= grenze ? i + 1 : s), 0);
}
function allgemeine(d) {
  return [
    {
      id: "level",
      name: "Spieler-Level",
      wert: levelAus(d.ep).level,
      stufen: [5, 10, 20],
      einheit: "Level",
    },
    {
      id: "serie",
      name: "Dranbleiber",
      wert: d.serie.beste || 0,
      stufen: [3, 7, 30],
      einheit: "Tage Serie",
    },
    {
      id: "aufgaben",
      name: "Fleißig",
      wert: d.aufgaben || 0,
      stufen: [10, 50, 200],
      einheit: "Tagesaufgaben",
    },
  ].map((x) => ({ ...x, wert: () => x.wert, allgemein: true }));
}
/** Alle Abzeichen mit Stand: [{id, name, stufe 0–3, wert, naechste, text}] */
export function abzeichenListe(d = daten()) {
  return [...SPIEL_ABZ, ...allgemeine(d)].map((a) => {
    const stufe = abzeichenStufe(a);
    return { ...a, stufe, wertJetzt: a.wert(), naechste: a.stufen[stufe] ?? null };
  });
}
function abzeichenPruefen(d, meldungen) {
  const erst = !d.abz; // erster Lauf: rückwirkend still eintragen
  d.abz ||= {};
  for (const a of abzeichenListe(d)) {
    const alt = d.abz[a.id]?.s || 0;
    if (a.stufe > alt) {
      d.abz[a.id] = { s: a.stufe, d: heute() };
      if (!erst)
        meldungen.push({
          art: "abzeichen",
          stufe: a.stufe,
          titel: `Abzeichen ${STUFEN[a.stufe - 1]}: ${a.name}`,
          text: a.text ? a.text[a.stufe - 1] : `${zahl(a.stufen[a.stufe - 1])} ${a.einheit}`,
        });
    }
  }
}

/* ---------- Ereignisse ---------- */
const pfadSpiel = () => location.pathname.split("/").filter(Boolean)[0] || "";
// Casino zählt bewusst NICHT zum Fortschritt (Wunsch Nutzer): keine EP, keine Abzeichen, kein "Weiterspielen"
const CASINO = [
  "slots",
  "angelglueck",
  "tempelschatz",
  "blackjack",
  "risikoleiter",
  "rubbellos",
  "poker",
];
const istCasino = () =>
  CASINO.includes(pfadSpiel()) || new URLSearchParams(location.search).get("modus") === "casino";

function verarbeiten(aenderung, vorab = []) {
  const d = daten();
  const levelVorher = levelAus(d.ep).level;
  const meldungen = [...vorab];
  const grund = aenderung(d, tagVon(d)) || 0;
  const ep = Math.round(grund * serienFaktor(serieAktiv(d)));
  d.ep += ep;
  auswerten(d, meldungen);
  abzeichenPruefen(d, meldungen);
  const lv = levelAus(d.ep);
  if (lv.level > levelVorher) {
    const neuerRang = rang(lv.level) !== rang(levelVorher);
    meldungen.push({
      art: "level",
      titel: `Level ${lv.level}!`,
      text: neuerRang
        ? `Neuer Rang: ${lv.rang}`
        : `Noch ${lv.noetig - lv.rest} EP bis Level ${lv.level + 1}.`,
    });
  }
  sichern(d);
  if (meldungen.length) toasts(meldungen);
  window.dispatchEvent(new CustomEvent("fortschritt", { detail: { ep, meldungen } }));
  return { ep, meldungen, level: lv };
}
function gespielt(t, s) {
  if (s && !t.spiele.includes(s)) t.spiele.push(s);
}

/** Runde beendet (gameOverDialog). Muss VOR stillEintragen laufen (Rekord-Vergleich). */
export function runde(toplisteId, { punkte = 0, richtung = "hoch" } = {}) {
  if (istCasino()) return null;
  const alt = pb(toplisteId);
  const rekord = punkte > 0 && (alt == null || (richtung === "hoch" ? punkte > alt : punkte < alt));
  return verarbeiten(
    (d, t) => {
      const s = pfadSpiel();
      t.runden++;
      const p = (t.proSpiel[s] ||= { r: 0, max: 0 });
      p.r++;
      if (richtung === "hoch") p.max = Math.max(p.max, punkte);
      gespielt(t, s);
      // Gegen "schnell sterben und EP sammeln": Runden-EP pro Tag gedeckelt, 0 Punkte = 2 EP
      let ep = punkte > 0 ? EP_RUNDE : 2;
      ep = Math.max(0, Math.min(ep, EP_RUNDEN_TAG - t.epRunden));
      t.epRunden += ep;
      return ep + (rekord ? EP_REKORD : 0);
    },
    rekord && alt != null
      ? [
          {
            art: "rekord",
            titel: "Neuer Rekord!",
            text: `Vorher ${zahl(alt)} – jetzt ${zahl(punkte)}. +${EP_REKORD} EP`,
          },
        ]
      : [],
  );
}

/** Level gewonnen (Sortierspiele, Zuckerzauber). sterneNeu = zusätzlich verdiente Sterne. */
export function levelGeschafft(spiel, { sterne = 0, sterneNeu = 0 } = {}) {
  return verarbeiten((d, t) => {
    t.runden++;
    t.level[spiel] = (t.level[spiel] || 0) + 1;
    t.sterne += sterne;
    gespielt(t, spiel);
    return 5 + 5 * sterne + 10 * sterneNeu;
  });
}

/** Casino-Runde (wallet.rundeAbschliessen): 1 EP, höchstens 100 am Tag. */
export function casinoRunde() {
  return null; // Casino gibt keine EP (bleibt für alte gecachte wallet.js)
}

/** "Zuletzt gespielt" – beim Laden jeder Spielseite. */
export function besuch() {
  const s = pfadSpiel();
  if (!s || /\.html$/.test(s) || istCasino()) return;
  const d = daten();
  d.zuletzt = [s, ...(d.zuletzt || []).filter((x) => x !== s)].slice(0, 6);
  sichern(d);
}

/** Einmal pro Tag (Startseite): Startbonus für Neue, Willkommen-zurück nach Pause. */
export function begruessen() {
  const d = daten(),
    h = heute(),
    meldungen = [];
  if (!d.gesehen) {
    d.ep += 30; // Startvorsprung: der Balken ist nie ganz leer
    meldungen.push({
      art: "level",
      titel: "Willkommen!",
      text: "Startbonus +30 EP. Erledige Tagesaufgaben für EP, Ränge und Abzeichen.",
    });
  } else if (d.gesehen !== h && tageZwischen(d.gesehen, h) >= 4) {
    d.ep += 50;
    meldungen.push({
      art: "bonus",
      titel: "Schön, dass du wieder da bist!",
      text: "Willkommensbonus +50 EP.",
    });
  }
  d.gesehen = h;
  abzeichenPruefen(d, []);
  sichern(d);
  if (meldungen.length) toasts(meldungen);
}

/* ---------- Abfragen für Anzeigen ---------- */
export function uebersicht() {
  const d = daten();
  tagVon(d);
  const s = d.serie,
    tage = serieAktiv(d);
  // Letzter Schontag: ohne Aufgabe heute reißt die Serie morgen
  const letzterTag = tage > 0 && s.letzter !== heute() && tageZwischen(s.letzter, heute()) === 3;
  return {
    ep: d.ep,
    ...levelAus(d.ep),
    serie: tage,
    serieHeute: s.letzter === heute(),
    serieLetzterTag: letzterTag,
    faktor: serienFaktor(tage),
    aufgaben: aufgabenHeute(),
    zuletzt: (d.zuletzt || []).filter((s) => !CASINO.includes(s)),
    abzeichen: abzeichenListe(d),
  };
}

/** Abzeichen zu einem Pfad (z. B. "snake", "slots") */
export function abzeichenZuPfad(pfad = pfadSpiel()) {
  return abzeichenListe().find((a) => a.id === pfad || a.pfade?.includes(pfad)) || null;
}

/** "Nächstes Ziel"-Text für den Spielende-Dialog */
export function naechstesZiel(pfad = pfadSpiel()) {
  const a = abzeichenZuPfad(pfad);
  if (!a) return "";
  if (a.naechste == null) return `${a.name}: alle Abzeichen geholt – Gold!`;
  const ziel = `${STUFEN[a.stufe]}-Abzeichen`;
  if (a.text) return `Nächstes Ziel: ${ziel} – ${a.text[a.stufe]}`;
  const fast = a.wertJetzt >= a.naechste * 0.7 ? "Fast geschafft! " : "";
  return `${fast}Nächstes Ziel: ${ziel} bei ${zahl(a.naechste)} ${a.einheit} (noch ${zahl(a.naechste - a.wertJetzt)})`;
}

/* ---------- Anzeige-Bausteine ---------- */
const NS = "http://www.w3.org/2000/svg";
/** Medaille als SVG (stufe 0 = noch offen) */
export function medaille(stufe, gross = 40) {
  const farben = [
    ["#2a2a44", "#3a3a5c"],
    ["#c9814b", "#7a4420"],
    ["#d9e0ea", "#7f8aa0"],
    ["#ffd34d", "#a8740a"],
  ][stufe];
  const s = document.createElementNS(NS, "svg");
  s.setAttribute("viewBox", "0 0 40 40");
  s.setAttribute("width", gross);
  s.setAttribute("height", gross);
  s.setAttribute("aria-hidden", "true");
  s.classList.add("medaille", `stufe-${stufe}`);
  s.innerHTML = `<path d="M13 2h6l-3 12h-6zM27 2h-6l3 12h6z" fill="${stufe ? "#ff4fa3" : "#33334d"}"/>
    <circle cx="20" cy="25" r="13" fill="${farben[0]}" stroke="${farben[1]}" stroke-width="2.5"/>
    <circle cx="20" cy="25" r="8.5" fill="none" stroke="${farben[1]}" stroke-opacity=".55" stroke-width="1.2"/>
    ${
      stufe
        ? `<path d="M20 18.5l2 4.2 4.6.6-3.4 3.1.9 4.5-4.1-2.3-4.1 2.3.9-4.5-3.4-3.1 4.6-.6z" fill="${farben[1]}"/>
    <path class="glanz" d="M11 21a10 10 0 0 1 6-7" stroke="#fff" stroke-opacity=".7" stroke-width="2" fill="none" stroke-linecap="round"/>`
        : `<text x="20" y="30" text-anchor="middle" font-size="13" fill="#6b6b90" font-family="sans-serif">?</text>`
    }`;
  return s;
}

/** Kleiner Kasten für Spielende-Dialoge: EP, Level-Balken, nächstes Ziel, Aufgaben */
export function dialogKasten(ergebnis, pfad = pfadSpiel()) {
  if (istCasino()) return document.createDocumentFragment();
  const u = uebersicht();
  const box = document.createElement("div");
  box.className = "fs-kasten";
  const kopf = document.createElement("div");
  kopf.className = "fs-kopf";
  const lv = document.createElement("span");
  lv.className = "fs-lv";
  lv.textContent = `Lv ${u.level}`;
  lv.title = u.rang;
  const balken = document.createElement("span");
  balken.className = "fs-balken";
  const fuell = document.createElement("i");
  // Animation: vom alten Stand zum neuen (bei Level-Aufstieg von 0)
  const vorher = Math.max(0, u.rest - (ergebnis?.ep || 0)) / u.noetig;
  fuell.style.setProperty("--von", (ergebnis?.ep > u.rest ? 0 : vorher).toFixed(3));
  fuell.style.setProperty("--bis", u.anteil.toFixed(3));
  balken.append(fuell);
  const ep = document.createElement("span");
  ep.className = "fs-ep";
  ep.textContent = ergebnis?.ep ? `+${ergebnis.ep} EP` : `${u.rest}/${u.noetig} EP`;
  kopf.append(lv, balken, ep);
  box.append(kopf);
  const ziel = naechstesZiel(pfad);
  if (ziel) {
    const p = document.createElement("p");
    p.className = "fs-ziel";
    p.textContent = ziel;
    box.append(p);
  }
  const offen = u.aufgaben.filter((a) => !a.fertig);
  const ul = document.createElement("ul");
  ul.className = "fs-mini";
  for (const a of u.aufgaben) {
    const li = document.createElement("li");
    if (a.fertig) li.classList.add("fertig");
    li.textContent = `${a.fertig ? "✓" : `${a.stand}/${a.ziel}`} · ${a.text}`;
    ul.append(li);
  }
  if (!offen.length) {
    const li = document.createElement("li");
    li.className = "fertig";
    li.textContent = "Alle Tagesaufgaben erledigt – morgen gibt es neue.";
    ul.replaceChildren(li);
  }
  box.append(ul);
  return box;
}

/* ---------- Einblendungen (Toasts) ---------- */
let leiste = null;
function toasts(liste) {
  if (typeof document === "undefined") return;
  if (!leiste || !leiste.isConnected) {
    leiste = document.createElement("div");
    leiste.className = "fs-toasts";
    leiste.setAttribute("role", "status");
    leiste.setAttribute("aria-live", "polite");
    document.body.append(leiste);
  }
  // Über offenen Dialogen sichtbar bleiben (showModal liegt in der Top-Layer)
  const offen = document.querySelector("dialog[open]");
  if (offen && leiste.parentNode !== offen) offen.append(leiste);
  else if (!offen && leiste.parentNode !== document.body) document.body.append(leiste);
  liste.forEach((m, i) => {
    setTimeout(() => {
      const t = document.createElement("div");
      t.className = `fs-toast art-${m.art}`;
      const bild = m.art === "abzeichen" ? medaille(m.stufe, 34) : symbol(m.art);
      const txt = document.createElement("div");
      const b = document.createElement("strong");
      b.textContent = m.titel;
      const s = document.createElement("span");
      s.textContent = m.text;
      txt.append(b, s);
      t.append(bild, txt);
      t.addEventListener("click", () => weg(t));
      leiste.append(t);
      while (leiste.children.length > 3) leiste.firstElementChild.remove();
      setTimeout(() => weg(t), 4200);
    }, i * 650);
  });
}
function weg(t) {
  if (!t.isConnected || t.classList.contains("raus")) return;
  t.classList.add("raus");
  setTimeout(() => t.remove(), 350);
}
function symbol(art) {
  const s = document.createElementNS(NS, "svg");
  s.setAttribute("viewBox", "0 0 34 34");
  s.setAttribute("width", 34);
  s.setAttribute("height", 34);
  s.setAttribute("aria-hidden", "true");
  s.innerHTML =
    art === "rekord"
      ? `<circle cx="17" cy="17" r="15" fill="#3d2a05" stroke="#ffd34d" stroke-width="2"/><path d="M11 9h12v4a6 6 0 0 1-12 0zM14 21h6v3h3v2H11v-2h3z" fill="#ffd34d"/>`
      : art === "level"
        ? `<circle cx="17" cy="17" r="15" fill="#2b1a55" stroke="#a78bfa" stroke-width="2"/><path d="M17 7l4 8h-3v10h-2V15h-3z" fill="#c4b5fd"/>`
        : `<circle cx="17" cy="17" r="15" fill="#0f3b2a" stroke="#7CFF6B" stroke-width="2"/><path d="M10 17.5l4.5 4.5L24 12" fill="none" stroke="#7CFF6B" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  return s;
}

// Eigenes Stylesheet einbinden (dann muss keine Spielseite angefasst werden)
export const VERSION = "20261024t";
if (typeof document !== "undefined" && !document.getElementById("fs-css")) {
  const l = document.createElement("link");
  l.id = "fs-css";
  l.rel = "stylesheet";
  l.href = new URL(`./fortschritt.css?v=${VERSION}`, import.meta.url).href;
  document.head.append(l);
}
// Jede Spielseite, die das Modul lädt, zählt als "zuletzt gespielt"
if (typeof location !== "undefined") besuch();
