/* ============================================================
   PIXELREX · game.js
   ------------------------------------------------------------
   SO FUNKTIONIERT DIESES SPIEL
   1. Zustand: Der Rex hat eine Höhe über dem Boden und eine
      Geschwindigkeit nach oben. Dazu kommen die gelaufene Strecke,
      eine Liste von Hindernissen und eine "phase" (bereit / laeuft /
      pause / vorbei) als einfache Zustandsmaschine.
   2. Welt statt Figur bewegt sich: Der Rex steht in Wahrheit immer
      bei x = 72. Wir schieben Hindernisse, Boden und Hintergrund nach
      LINKS. Das ist einfacher als eine Kamera und fühlt sich gleich an.
   3. Spielschleife: requestAnimationFrame ruft einzelbild() einmal pro
      Bildschirm-Frame auf. Die Physik läuft in festen kleinen Schritten
      (1/240 s) nach dem Muster "Akkumulator" wie bei Snake. So ist die
      Sprunghöhe auf einem 60-Hz-Handy und einem 144-Hz-Monitor identisch.
   4. Regeln stecken in logik.js (pure Funktionen: Physik, Kollision,
      Hindernis-Erzeugung). Hier in game.js liegen Eingabe, Schleife und
      Zeichnen. Dadurch lässt sich die Logik ohne Browser testen.
   5. Zeichnen: Das Canvas wird in jedem Frame komplett neu gemalt:
      Himmel, zwei Parallax-Ebenen, Boden, Hindernisse, Rex, Partikel,
      Overlays. Alle Figuren bestehen aus Rechtecken und Pfaden.
   6. Ende: Bei einem Treffer blitzt das Feld kurz auf, danach übernimmt
      gameOverDialog() aus ui.js (Initialen, Topliste, "Nochmal").
   ============================================================ */

import { topliste, spielZuruecksetzen } from "./assets/storage.js";
import { bewegungReduziert, gameOverDialog, toplisteAnzeigen } from "./assets/ui.js";
import { spielSeite, text, TASTE, ansage } from "./assets/mobil.js";
import { levelWahl } from "./assets/levelwahl.js";
import {
  BREITE,
  HOEHE,
  BODEN_Y,
  REX_X,
  tempoNachZeit,
  punkteAusStrecke,
  naechsterAbstand,
  hindernisErzeugen,
  neuerRex,
  sprungStarten,
  sprungKappen,
  rexSchritt,
  rexRechteck,
  rexHitbox,
  kollidiertMitHindernis,
  BIOME,
  biomIndex,
} from "./logik.js";

/* ---------- Konstanten (Stellschrauben des Spiels) ---------- */
const SPIEL = "pixelrex"; // Schlüssel für den Speicher (storage.js)
const SCHRITT = 1 / 240; // Physik-Zeitschritt in Sekunden (fest!)
const MAX_FRAME_ABSTAND_MS = 250; // siehe einzelbild()
const BLITZ_DAUER_MS = 650; // Länge des Aufblitzens nach dem Treffer
const SPRUNG_PUFFER = 0.12; // Sekunden, die ein zu früher Tastendruck "gemerkt" wird
const ERSTES_HINDERNIS_X = 520; // so weit rechts steht das erste Hindernis
const SPAWN_LINIE = BREITE + 40; // ab hier (knapp rechts außerhalb) tauchen neue Hindernisse auf
const WISCH_SCHWELLE = 24; // Pixel nach unten, ab denen ein Finger "duckt"
const SPERRE_NACH_DIALOG_MS = 700; // siehe dialogEntschaerfen()
const ZELLE = 4; // Kantenlänge eines "Pixels" im Rex-Sprite

// Tastatur-Zuordnung (Kleinbuchstaben, damit "W" und "w" gleich zählen)
const TASTEN_SPRUNG = new Set([" ", "arrowup", "w"]);
const TASTEN_DUCKEN = new Set(["arrowdown", "s"]);

/* ---------- Elemente der Seite ---------- */
const leinwand = document.getElementById("leinwand");
// zeichner ist "let": Die Szene entsteht auf einem halb so großen Canvas und
// wird dann ohne Glätten hochskaliert (Pixel-Look). Texte kommen danach scharf dazu.
const hauptZ = leinwand.getContext("2d");
let zeichner = hauptZ;
const PIXEL_RASTER = 0.5;
const pixelLeinwand = document.createElement("canvas");
const pixelZ = pixelLeinwand.getContext("2d");
const hudPunkte = document.getElementById("hud-punkte");
const hudRekord = document.getElementById("hud-rekord");
const hudWelt = document.getElementById("hud-welt");
const toplisteBox = document.getElementById("topliste");
const resetKnopf = document.getElementById("reset");

// Das Canvas hat intern immer 640x240 Pixel. CSS skaliert es nur.
leinwand.width = BREITE;
leinwand.height = HOEHE;
pixelLeinwand.width = BREITE * PIXEL_RASTER;
pixelLeinwand.height = HOEHE * PIXEL_RASTER;
// Sonst würde der Browser bei Berührungen auf dem Spielfeld scrollen/zoomen.
leinwand.style.touchAction = "none";

/* ---------- Farben aus dem Design lesen ----------
   Die Farben kommen aus den CSS-Variablen von style.css. Ändert sich das
   Design, passt sich das Spielfeld automatisch an. Das zweite Argument
   ist ein Notnagel, falls eine Variable leer sein sollte. */
const bodyStil = getComputedStyle(document.body);
function lesFarbe(name, notfall) {
  return bodyStil.getPropertyValue(name).trim() || notfall;
}

/** Mischt eine #rrggbb-Farbe mit Weiß (0 = unverändert, 1 = weiß). */
function mischeMitWeiss(farbe, anteil) {
  const treffer = /^#([0-9a-f]{6})$/i.exec(farbe);
  if (!treffer) return farbe;
  const zahl = parseInt(treffer[1], 16);
  // Ein 24-Bit-Wert besteht aus drei Bytes (Rot, Grün, Blau). Mit
  // Bit-Verschiebung (>>) und Maske (& 255) holen wir sie einzeln heraus.
  const kanaele = [(zahl >> 16) & 255, (zahl >> 8) & 255, zahl & 255].map((k) =>
    Math.round(k + (255 - k) * anteil),
  );
  return `rgb(${kanaele.join(",")})`;
}

const farben = {
  hintergrund: lesFarbe("--bg", "#07070f"),
  flaeche: lesFarbe("--panel", "#111124"),
  flaeche2: lesFarbe("--panel2", "#181834"),
  linie: lesFarbe("--line", "#2b2b52"),
  rex: lesFarbe("--pink", "#ff2d78"),
  kristall: lesFarbe("--cyan", "#00e5ff"),
  saeule: lesFarbe("--violet", "#b28dff"),
  drohne: lesFarbe("--gold", "#ffc84d"),
  text: lesFarbe("--txt", "#eef0ff"),
  gedaempft: lesFarbe("--mut", "#9aa0c6"),
  schriftPixel: lesFarbe("--pixel", "monospace"),
  schriftText: lesFarbe("--sans", "sans-serif"),
};
farben.rexHell = mischeMitWeiss(farben.rex, 0.4);

/* Farben je Welt (im Spielfeld gilt die Welt, außerhalb das Neon-Design).
   himmel = Verlauf oben -> unten. */
const WELT_FARBEN = [
  {
    himmel: ["#07070f", "#16163a"],
    flaeche: "#111124",
    flaeche2: "#1c1c40",
    kristall: "#00e5ff",
    saeule: "#b28dff",
  },
  {
    himmel: ["#2b1035", "#c4553a"],
    flaeche: "#3a1c33",
    flaeche2: "#5e2b3c",
    kristall: "#ffcf5a",
    saeule: "#ff8a3d",
  },
  {
    himmel: ["#120404", "#55140a"],
    flaeche: "#261010",
    flaeche2: "#3f1912",
    kristall: "#ff6a2a",
    saeule: "#ffb03a",
    lava: "#ff4a1a",
  },
  {
    himmel: ["#04121e", "#16506f"],
    flaeche: "#0d2436",
    flaeche2: "#17405c",
    kristall: "#bff4ff",
    saeule: "#7fd0ff",
    eis: "#dff8ff",
  },
  {
    himmel: ["#020208", "#0d0d2e"],
    flaeche: "#0d0d22",
    flaeche2: "#17173e",
    kristall: "#9dff00",
    saeule: "#ff2d78",
    lava: "#ff4a1a",
    eis: "#dff8ff",
  },
];
function weltFarbenSetzen(nr) {
  Object.assign(farben, { lava: "#ff4a1a", eis: "#dff8ff" }, WELT_FARBEN[nr]);
}

/* ---------- Spielzustand ---------- */
let rex; // { hoehe, v, amBoden } aus logik.js
let hindernisse; // [{ art, x, breite, teile }, …]
let letzterRand; // rechte Kante des zuletzt erzeugten Hindernisses (wandert mit der Welt nach links)
let abstandZumNaechsten; // so viel Platz muss nach letzterRand bis zum nächsten Hindernis sein
let strecke; // gelaufene Pixel (Punkte = strecke / 10)
let laufzeit; // Sekunden seit Spielstart, steuert das Tempo
let punkte;
let rekordGespeichert = 0;
let rekordGepulst; // Puls nur einmal pro Spiel
let phase; // "bereit" | "laeuft" | "pause" | "vorbei"
let welt = 0; // Index in BIOME
let startWelt = 0; // in der Auswahl gewählte Start-Welt
let banner = "",
  bannerBis = 0;
let akkumulator = 0; // angesammelte, noch nicht "verbrauchte" Zeit in Sekunden
let letzteZeit = 0;
let blitzStart = 0;
let dialogGezeigt = false;
let partikel = []; // Staub und Funken (reine Deko)
let ruhigerModus = bewegungReduziert();

// Eingabe-Zustand
let sprungPuffer = 0; // > 0: Sprung wurde gewünscht und wartet auf die Landung
let tasteSprung = false; // Sprungtaste gerade gedrückt?
let zeigerSprung = false; // Finger/Maus gerade auf dem Spielfeld?
let tasteDucken = false;
let zeigerDucken = false;

/* ============================================================
   HUD
   ============================================================ */

function toplisteAktualisieren() {
  const liste = topliste(SPIEL);
  rekordGespeichert = liste.length > 0 ? liste[0].punkte : 0;
  toplisteAnzeigen(toplisteBox, SPIEL, (p) => `${p} m`);
}

/** Rekord "live": Sobald die aktuellen Punkte ihn übertreffen, zieht er mit. */
function rekordLive() {
  return Math.max(rekordGespeichert, punkte);
}

/**
 * Schreibt die HUD-Werte, aber nur, wenn sie sich geändert haben.
 * Der Punktestand steigt ohnehin laufend (viele kleine Schritte pro
 * Sekunde), ein zusätzlicher Zähler-Ticker wäre überflüssig.
 */
function hudAktualisieren() {
  if (hudPunkte.textContent !== String(punkte)) hudPunkte.textContent = punkte;
  const rekord = String(rekordLive());
  if (hudRekord.textContent !== rekord) hudRekord.textContent = rekord;
}

/** Kurzer Puls am Rekordfeld, genau in dem Moment, in dem er geknackt wird. */
function rekordPulsen() {
  hudRekord.classList.remove("rekord-puls");
  void hudRekord.offsetWidth; // erzwingt Neuberechnung des Layouts, damit die Animation neu startet
  hudRekord.classList.add("rekord-puls");
  hudRekord.addEventListener("animationend", () => hudRekord.classList.remove("rekord-puls"), {
    once: true,
  });
}

/* ============================================================
   Spielablauf
   ============================================================ */

/** Setzt alles auf Anfang. Wird beim Laden und bei "Nochmal" aufgerufen. */
function neuesSpiel(ab = startWelt) {
  startWelt = ab;
  welt = ab;
  weltFarbenSetzen(welt);
  wahl.aktiv(welt + 1);
  hudWelt.textContent = String(welt + 1);
  rex = neuerRex();
  hindernisse = [];
  strecke = 0;
  laufzeit = 0;
  punkte = 0;
  rekordGepulst = false;
  partikel = [];
  akkumulator = 0;
  sprungPuffer = 0;
  dialogGezeigt = false;
  phase = "bereit";

  // Das erste Hindernis steht schon im Bild, bevor das Spiel startet.
  // Mit abstandZumNaechsten = 0 landet es genau bei ERSTES_HINDERNIS_X.
  letzterRand = ERSTES_HINDERNIS_X;
  abstandZumNaechsten = 0;
  hindernisseNachlegen();

  toplisteAktualisieren();
  hudPunkte.textContent = "0";
  hudRekord.textContent = String(rekordGespeichert);
}

/**
 * Legt neue Hindernisse an, solange die Spawn-Linie (knapp rechts außerhalb
 * des Bildes) noch nicht erreicht ist.
 *
 * Wir merken uns nur `letzterRand`, die rechte Kante des zuletzt erzeugten
 * Hindernisses. Sie wandert wie alles andere mit der Welt nach links. Sobald
 *     letzterRand + abstandZumNaechsten <= SPAWN_LINIE
 * gilt, ist genug Platz: Das neue Hindernis entsteht dann GENAU
 * abstandZumNaechsten hinter dem alten. So bleibt die Lücke exakt so
 * groß, wie logik.js sie berechnet hat, egal wie viele Frames vergangen sind.
 */
function hindernisseNachlegen() {
  while (letzterRand + abstandZumNaechsten <= SPAWN_LINIE) {
    // Hindernisse richten sich nach der Welt: Wer in einer späteren Welt
    // startet, bekommt gleich deren Hindernisse (auch Drohnen).
    const hindernis = hindernisErzeugen(Math.max(punkte, BIOME[welt].ab), Math.random, BIOME[welt]);
    hindernis.x = letzterRand + abstandZumNaechsten;
    hindernisse.push(hindernis);
    letzterRand = hindernis.x + hindernis.breite;
    // Der Abstand zum NÄCHSTEN richtet sich nach dem aktuellen Tempo
    // (Begründung bei mindestAbstand() in logik.js).
    abstandZumNaechsten = naechsterAbstand(tempoNachZeit(laufzeit), Math.random());
  }
}

/**
 * Ein Physikschritt von genau SCHRITT Sekunden. Hier steckt der gesamte
 * Spielablauf, ganz ohne Zeichnen.
 */
function schritt() {
  const tempo = tempoNachZeit(laufzeit);
  const ducken = tasteDucken || zeigerDucken;

  // 1) Sprung: gemerkten Wunsch einlösen, sobald der Rex am Boden steht.
  //    Der Puffer verzeiht Tastendrücke, die ein paar Millisekunden ZU
  //    FRÜH kommen (noch kurz vor der Landung). Ohne ihn "verschluckt" das
  //    Spiel solche Eingaben, und der Spieler denkt, die Taste hätte geklemmt.
  if (sprungPuffer > 0) {
    sprungPuffer -= SCHRITT;
    if (sprungStarten(rex)) {
      sprungPuffer = 0;
      staubErzeugen(REX_X + 14, 6);
    }
  }
  // Variable Sprunghöhe: Taste früh losgelassen = kleiner Hüpfer.
  if (!tasteSprung && !zeigerSprung) sprungKappen(rex);

  // 2) Rex bewegen
  if (rexSchritt(rex, SCHRITT, ducken)) staubErzeugen(REX_X + 20, 8);

  // 3) Welt nach links schieben
  laufzeit += SCHRITT;
  strecke += tempo * SCHRITT;
  for (const h of hindernisse) h.x -= tempo * SCHRITT;
  letzterRand -= tempo * SCHRITT;
  // Hindernisse, die komplett links aus dem Bild sind, aussortieren
  hindernisse = hindernisse.filter((h) => h.x + h.breite > -20);
  hindernisseNachlegen();

  // 4) Punkte
  punkte = punkteAusStrecke(strecke);
  if (!rekordGepulst && rekordGespeichert > 0 && punkte > rekordGespeichert) {
    rekordGepulst = true;
    if (!ruhigerModus) rekordPulsen();
  }

  // Weltwechsel?
  const neueWelt = biomIndex(punkte, startWelt);
  if (neueWelt !== welt) {
    welt = neueWelt;
    weltFarbenSetzen(welt);
    hudWelt.textContent = String(welt + 1);
    banner = `WELT ${welt + 1} · ${BIOME[welt].name.toUpperCase()}`;
    bannerBis = laufzeit + 2.2;
    wahl.erreicht(welt + 1);
    wahl.aktiv(welt + 1);
    ansage(`Welt ${welt + 1}: ${BIOME[welt].name}`);
  }

  // 5) Kollision: Rex-Hitbox gegen alle Hindernisse
  const box = rexHitbox(rex, ducken);
  if (hindernisse.some((h) => kollidiertMitHindernis(box, h))) spielBeenden();
}

function spielBeenden() {
  phase = "vorbei";
  blitzStart = performance.now();
  funkenErzeugen();
  hudAktualisieren();
  // Wer Bewegung reduziert haben möchte, bekommt keinen Blitz: sofort Dialog.
  if (ruhigerModus) dialogAnzeigen();
}

function dialogAnzeigen() {
  if (dialogGezeigt) return;
  dialogGezeigt = true;
  const dialog = gameOverDialog({
    spiel: SPIEL,
    punkte,
    punkteText: `${punkte} m`,
    richtung: "hoch", // bei Pixelrex ist MEHR besser
    format: (p) => `${p} m`,
    neustart: neuesSpiel,
  });
  dialogEntschaerfen(dialog);
  // Auch beim Schließen mit Esc (ohne "Nochmal") soll die Seite den neuen Stand zeigen.
  dialog.addEventListener("close", () => {
    toplisteAktualisieren();
    hudAktualisieren();
  });
}

/**
 * Schützt vor "Durchrutschen": Wer beim Sterben gerade wild Leertaste
 * drückt oder aufs Handy tippt, würde den Dialog sonst sofort wieder
 * wegklicken ("Nochmal" ist der fokussierte Knopf), noch bevor man sein
 * Ergebnis gesehen oder Initialen eingetragen hat.
 * Deshalb ignoriert der Dialog für eine kurze Zeit alle Tasten- und
 * Zeiger-Eingaben. Danach funktioniert alles normal.
 */
function dialogEntschaerfen(dialog) {
  const bis = performance.now() + SPERRE_NACH_DIALOG_MS;
  const sperren = (ereignis) => {
    if (performance.now() < bis && document.getElementById("spiel-dialog")) {
      ereignis.preventDefault();
      ereignis.stopPropagation();
    }
  };
  // Capture-Phase (true): Wir sind vor dem Knopf an der Reihe.
  document.addEventListener("keydown", sperren, true);
  document.addEventListener("keyup", sperren, true);
  dialog.style.pointerEvents = "none";
  setTimeout(() => {
    dialog.style.pointerEvents = "";
    document.removeEventListener("keydown", sperren, true);
    document.removeEventListener("keyup", sperren, true);
  }, SPERRE_NACH_DIALOG_MS);
}

/* ---------- Start / Pause ---------- */

function spielStarten() {
  phase = "laeuft";
  akkumulator = 0;
}

function pauseUmschalten() {
  if (phase === "laeuft") phase = "pause";
  else if (phase === "pause") phase = "laeuft";
}

/** Sprung gewünscht: je nach Phase starten, weitermachen oder springen. */
function sprungDruecken() {
  if (phase === "bereit") {
    spielStarten();
    sprungPuffer = SPRUNG_PUFFER; // die erste Eingabe startet UND springt
  } else if (phase === "laeuft") {
    sprungPuffer = SPRUNG_PUFFER;
  } else if (phase === "pause") {
    phase = "laeuft";
  } else if (phase === "vorbei" && dialogGezeigt && !document.getElementById("spiel-dialog")) {
    neuesSpiel(); // Dialog wurde mit Esc geschlossen: neu beginnen
  }
}

/* ============================================================
   Eingabe: Tastatur
   ============================================================ */
document.addEventListener("keydown", (ereignis) => {
  // Browser-Kürzel (Strg+R, Cmd+W …) nicht stören.
  if (ereignis.ctrlKey || ereignis.metaKey || ereignis.altKey) return;
  // Offener Game-Over-Dialog: Dort tippt man Initialen.
  if (document.getElementById("spiel-dialog")) return;

  const ziel = ereignis.target;
  if (ziel instanceof HTMLElement && ziel.matches("input, textarea, select")) return;

  const taste = ereignis.key.toLowerCase();

  if (taste === "p") {
    if (phase === "laeuft" || phase === "pause") pauseUmschalten();
    return;
  }

  if (TASTEN_SPRUNG.has(taste)) {
    // Leertaste auf einem fokussierten Knopf/Link soll diesen bedienen
    // (Reset-Knopf, Zusammenklappbox), nicht das Spiel.
    if (taste === " " && ziel instanceof HTMLElement && ziel.matches("button, a, summary")) return;
    ereignis.preventDefault(); // Pfeil/Leertaste würden sonst scrollen
    tasteSprung = true;
    // Halten der Taste löst Auto-Wiederholung aus (ereignis.repeat).
    // Das soll KEINEN neuen Sprung auslösen, sonst hüpft der Rex ununterbrochen.
    if (!ereignis.repeat) sprungDruecken();
  } else if (TASTEN_DUCKEN.has(taste)) {
    ereignis.preventDefault();
    tasteDucken = true;
  }
});

// keyup immer auswerten (auch bei offenem Dialog), sonst bliebe eine Taste
// "hängen", die man erst im Dialog loslässt.
document.addEventListener("keyup", (ereignis) => {
  const taste = ereignis.key.toLowerCase();
  if (TASTEN_SPRUNG.has(taste)) tasteSprung = false;
  if (TASTEN_DUCKEN.has(taste)) tasteDucken = false;
});

/* ============================================================
   Eingabe: Tippen, Klicken und Wischen (Pointer Events)
   ============================================================ */
let zeigerStart = null; // Punkt, an dem die aktuelle Berührung begann

leinwand.addEventListener("pointerdown", (ereignis) => {
  zeigerStart = { x: ereignis.clientX, y: ereignis.clientY };
  zeigerSprung = true;
  zeigerDucken = false;
  // "Capture": Auch wenn der Finger das Canvas verlässt, bekommen wir
  // weiter alle Bewegungen und das Loslassen.
  leinwand.setPointerCapture(ereignis.pointerId);
  sprungDruecken();
});

leinwand.addEventListener("pointermove", (ereignis) => {
  if (!zeigerStart) return;
  // Finger gedrückt halten und nach unten ziehen = ducken (bzw. schneller fallen).
  // Tippen allein springt immer, deshalb ist das Ducken am Handy nur ein
  // Zusatz: Eine tiefe Drohne kann man auch einfach überspringen.
  if (ereignis.clientY - zeigerStart.y > WISCH_SCHWELLE) zeigerDucken = true;
});

function zeigerLoslassen() {
  zeigerStart = null;
  zeigerSprung = false;
  zeigerDucken = false;
}
leinwand.addEventListener("pointerup", zeigerLoslassen);
leinwand.addEventListener("pointercancel", zeigerLoslassen);

// Tab-Wechsel oder Fensterfokus weg: Das Spiel pausiert, und gedrückte
// Tasten werden "vergessen" (ein keyup im anderen Fenster bekommen wir nie mit).
function eingabeVergessen() {
  tasteSprung = false;
  tasteDucken = false;
  zeigerSprung = false;
  zeigerDucken = false;
  if (phase === "laeuft") phase = "pause";
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) eingabeVergessen();
});
window.addEventListener("blur", eingabeVergessen);

/* ---------- Reset-Knopf ---------- */
resetKnopf.addEventListener("click", () => {
  spielZuruecksetzen(SPIEL);
  wahl.neuLaden();
  toplisteAktualisieren(); // Liste leer, Rekord wieder 0
  hudAktualisieren();
  if (phase === "laeuft") phase = "pause"; // nicht im Hintergrund weiterspielen
  resetKnopf.blur(); // sonst würde die nächste Leertaste den Knopf drücken
});

/* ============================================================
   Hauptschleife
   ============================================================ */

/**
 * Wird vom Browser einmal pro Bildschirm-Frame aufgerufen.
 *
 * MUSTER "AKKUMULATOR / FESTER ZEITSCHRITT" (wie bei Snake):
 * Frames kommen je nach Gerät 30-, 60- oder 144-mal pro Sekunde. Bei einem
 * Sprung ist das entscheidend: Rechnet man pro Frame mit "dt = Zeit seit
 * letztem Frame", fällt die Integration ungenau aus, und die Sprunghöhe
 * unterscheidet sich je nach Bildrate leicht. Bei festen 1/240-Sekunden-
 * Schritten ist die Rechnung auf JEDEM Gerät dieselbe. Pro Frame sammeln
 * wir die vergangene Zeit im Akkumulator und verbrauchen sie in
 * 1/240-Portionen. Bei langsamen Frames werden mehrere Schritte nachgeholt.
 */
function einzelbild(jetzt) {
  // Abstand begrenzen: Nach langer Pause (Tab im Hintergrund, Debugger)
  // wären sonst Hunderte Schritte auf einmal fällig.
  const abstandMs = Math.min(jetzt - letzteZeit, MAX_FRAME_ABSTAND_MS);
  letzteZeit = jetzt;
  ruhigerModus = bewegungReduziert(); // Nutzer kann die Einstellung jederzeit ändern

  if (phase === "laeuft") {
    akkumulator += abstandMs / 1000;
    while (phase === "laeuft" && akkumulator >= SCHRITT) {
      akkumulator -= SCHRITT;
      schritt();
    }
    hudAktualisieren();
  }

  partikelBewegen(abstandMs / 1000);

  // Nach dem Aufblitzen den Dialog zeigen (genau einmal).
  if (phase === "vorbei" && !dialogGezeigt && jetzt - blitzStart >= BLITZ_DAUER_MS) {
    dialogAnzeigen();
  }

  zeichneAlles(jetzt);
  requestAnimationFrame(einzelbild);
}

/* ============================================================
   Zeichnen
   ============================================================ */

/**
 * Parallax-Ebenen: Der Hintergrund besteht aus zwei "Kacheln" der Breite
 * des Spielfelds, die nahtlos wiederholt werden. Die hintere Ebene (Berge)
 * wandert langsam, die vordere (Kristall-Silhouetten) etwas schneller.
 * Unterschiedliche Geschwindigkeiten täuschen Tiefe vor, das ist der
 * "Parallax-Effekt". Weil Bewegung hier nur Deko ist, stehen die Ebenen
 * bei bewegungReduziert() still (sie werden trotzdem gezeichnet).
 */
const PARALLAX_HINTEN = 0.12; // Anteil der Weltgeschwindigkeit
const PARALLAX_VORNE = 0.35;

/** Zufällige Höhen für eine nahtlose Bergkette (letzter Punkt = erster Punkt). */
function bergkette(anzahl, minHoehe, maxHoehe) {
  const hoehen = [];
  for (let i = 0; i < anzahl; i++) hoehen.push(minHoehe + Math.random() * (maxHoehe - minHoehe));
  hoehen.push(hoehen[0]); // schließt die Kachel: rechts passt es wieder an links
  return hoehen;
}
const bergeHinten = bergkette(10, 28, 90);

// Vordere Ebene: einzelne Kristall-Silhouetten (Position, Breite, Höhe)
const silhouetten = [];
for (let x = 20; x < BREITE - 40; x += 70 + Math.random() * 90) {
  silhouetten.push({ x, b: 14 + Math.random() * 16, h: 24 + Math.random() * 36 });
}

// Kleine Steine/Striche auf dem Boden, damit man das Tempo sieht
const bodenMarken = [];
for (let x = 0; x < BREITE; x += 24 + Math.random() * 50) {
  bodenMarken.push({
    x,
    y: BODEN_Y + 10 + Math.random() * (HOEHE - BODEN_Y - 20),
    b: 4 + Math.random() * 10,
  });
}

/** Lava-Pfütze: glühende Fläche mit aufsteigenden Blasen. */
function zeichneLava(x, y, b, h, jetzt) {
  const z = zeichner;
  z.save();
  z.shadowColor = farben.lava;
  z.shadowBlur = 12;
  z.fillStyle = farben.lava;
  z.fillRect(x, y + 2, b, h);
  z.shadowBlur = 0;
  z.fillStyle = "#ffd25a";
  for (let i = 0; i < b; i += 12) {
    const t = ruhigerModus ? 0.5 : (jetzt / 500 + i * 0.13) % 1;
    z.fillRect(x + i + 3, y + 2 - t * 10, 3, 3);
  }
  z.restore();
}

/** Eiszapfen: hängt von oben, endet knapp über dem Boden. */
function zeichneEiszapfen(x, y, b, h) {
  const z = zeichner;
  z.save();
  z.fillStyle = farben.eis;
  z.shadowColor = farben.kristall;
  z.shadowBlur = 8;
  z.beginPath();
  z.moveTo(x, y);
  z.lineTo(x + b, y);
  z.lineTo(x + b * 0.7, y + h * 0.85);
  z.lineTo(x + b / 2, y + h);
  z.lineTo(x + b * 0.3, y + h * 0.85);
  z.closePath();
  z.fill();
  z.shadowBlur = 0;
  z.fillStyle = "#ffffff";
  z.fillRect(x + 4, y, 3, h * 0.6);
  z.restore();
}

function zeichneAlles(jetzt) {
  // --- Szene auf das halb so große Canvas ---
  zeichner = pixelZ;
  const z = zeichner;
  z.setTransform(PIXEL_RASTER, 0, 0, PIXEL_RASTER, 0, 0);
  z.globalAlpha = 1;
  z.shadowBlur = 0;

  // Himmel der aktuellen Welt (Verlauf), in jedem Frame neu
  const verlauf = z.createLinearGradient(0, 0, 0, BODEN_Y);
  verlauf.addColorStop(0, farben.himmel[0]);
  verlauf.addColorStop(1, farben.himmel[1]);
  z.fillStyle = verlauf;
  z.fillRect(0, 0, BREITE, HOEHE);

  zeichneHintergrund();
  zeichneBoden();
  for (const h of hindernisse) zeichneHindernis(h, jetzt);
  zeichneRex(jetzt);
  zeichnePartikel();

  // --- ohne Glätten hochskalieren: Pixel-Look ---
  zeichner = hauptZ;
  hauptZ.setTransform(1, 0, 0, 1, 0, 0);
  hauptZ.imageSmoothingEnabled = false;
  hauptZ.drawImage(pixelLeinwand, 0, 0, BREITE, HOEHE);
  hauptZ.imageSmoothingEnabled = true;

  if (banner && laufzeit < bannerBis && phase === "laeuft") {
    hauptZ.save();
    hauptZ.textAlign = "center";
    hauptZ.textBaseline = "middle";
    hauptZ.font = `14px ${farben.schriftPixel}`;
    hauptZ.fillStyle = farben.text;
    hauptZ.shadowColor = "#000";
    hauptZ.shadowBlur = 6;
    hauptZ.fillText(banner, BREITE / 2, 36);
    hauptZ.restore();
  }

  if (phase === "bereit") {
    zeichneOverlay(
      `WELT ${welt + 1} · ${BIOME[welt].name.toUpperCase()}`,
      text("Leertaste, ↑ oder Tippen startet", "Tippen oder SPRUNG startet"),
      jetzt,
    );
  } else if (phase === "pause") {
    zeichneOverlay("PAUSE", text("P oder Leertaste: weiter", "Antippen: weiter"), jetzt);
  } else if (phase === "vorbei" && !ruhigerModus) {
    zeichneBlitz(jetzt);
  }
}

function zeichneHintergrund() {
  const z = zeichner;
  // Bewegung der Ebenen: Strecke * Faktor, modulo Kachelbreite (läuft endlos im Kreis).
  const versatzHinten = ruhigerModus ? 0 : (strecke * PARALLAX_HINTEN) % BREITE;
  const versatzVorne = ruhigerModus ? 0 : (strecke * PARALLAX_VORNE) % BREITE;
  const kettenSchritt = BREITE / (bergeHinten.length - 1);

  // Hintere Ebene: Bergkette als gefülltes Polygon (zweimal nebeneinander gezeichnet)
  z.fillStyle = farben.flaeche;
  for (const kachel of [0, 1]) {
    const basisX = kachel * BREITE - versatzHinten;
    z.beginPath();
    z.moveTo(basisX, BODEN_Y);
    bergeHinten.forEach((h, i) => z.lineTo(basisX + i * kettenSchritt, BODEN_Y - h));
    z.lineTo(basisX + BREITE, BODEN_Y);
    z.closePath();
    z.fill();
  }

  // Vordere Ebene: spitze Kristall-Silhouetten
  z.fillStyle = farben.flaeche2;
  for (const kachel of [0, 1]) {
    const basisX = kachel * BREITE - versatzVorne;
    for (const s of silhouetten) {
      z.beginPath();
      z.moveTo(basisX + s.x, BODEN_Y);
      z.lineTo(basisX + s.x + s.b * 0.15, BODEN_Y - s.h * 0.7);
      z.lineTo(basisX + s.x + s.b / 2, BODEN_Y - s.h);
      z.lineTo(basisX + s.x + s.b * 0.85, BODEN_Y - s.h * 0.7);
      z.lineTo(basisX + s.x + s.b, BODEN_Y);
      z.closePath();
      z.fill();
    }
  }
}

function zeichneBoden() {
  const z = zeichner;
  z.fillStyle = farben.flaeche;
  z.fillRect(0, BODEN_Y, BREITE, HOEHE - BODEN_Y);

  // Leuchtende Bodenlinie
  z.save();
  z.fillStyle = farben.rex;
  z.shadowColor = farben.rex;
  z.shadowBlur = 8;
  z.globalAlpha = 0.85;
  z.fillRect(0, BODEN_Y, BREITE, 2);
  z.restore();

  // Marken laufen mit der vollen Weltgeschwindigkeit nach links. Das ist
  // Spielinformation (man sieht das Tempo), keine Deko, und läuft daher
  // auch bei reduzierter Bewegung.
  const versatz = strecke % BREITE;
  z.fillStyle = farben.linie;
  for (const m of bodenMarken) {
    let x = m.x - versatz;
    if (x + m.b < 0) x += BREITE; // links raus = rechts wieder rein
    z.fillRect(Math.round(x), Math.round(m.y), Math.round(m.b), 2);
  }
}

/* ---------- Hindernisse ---------- */

function zeichneHindernis(h, jetzt) {
  const z = zeichner;
  z.save();
  for (const teil of h.teile) {
    const x = h.x + teil.dx;
    const y = BODEN_Y - teil.dy - teil.h;
    if (h.art === "kristall") zeichneKristall(x, y, teil.b, teil.h);
    else if (h.art === "saeule") zeichneSaeule(x, y, teil.b, teil.h);
    else if (h.art === "lava") zeichneLava(x, y, teil.b, teil.h, jetzt);
    else if (h.art === "eiszapfen") zeichneEiszapfen(x, y, teil.b, teil.h);
    else zeichneDrohne(x, y, teil.b, teil.h, jetzt);
  }
  z.restore();
}

/** Kristall: Spitze oben, zwei Schultern, eine hellere Seitenfläche für Tiefe. */
function zeichneKristall(x, y, b, h) {
  const z = zeichner;
  z.shadowColor = farben.kristall;
  z.shadowBlur = 10;
  z.fillStyle = farben.kristall;
  z.beginPath();
  z.moveTo(x, y + h);
  z.lineTo(x, y + h * 0.32);
  z.lineTo(x + b / 2, y);
  z.lineTo(x + b, y + h * 0.32);
  z.lineTo(x + b, y + h);
  z.closePath();
  z.fill();

  // Rechte Fläche heller (Lichtkante), ohne Glühen
  z.shadowBlur = 0;
  z.fillStyle = mischeMitWeiss(farben.kristall, 0.55);
  z.globalAlpha = 0.65;
  z.beginPath();
  z.moveTo(x + b / 2, y);
  z.lineTo(x + b, y + h * 0.32);
  z.lineTo(x + b, y + h);
  z.lineTo(x + b * 0.6, y + h);
  z.lineTo(x + b * 0.6, y + h * 0.22);
  z.closePath();
  z.fill();
}

/** Energiesäule: Rechteck mit Segmentlinien und leuchtendem Kern. */
function zeichneSaeule(x, y, b, h) {
  const z = zeichner;
  z.shadowColor = farben.saeule;
  z.shadowBlur = 10;
  z.fillStyle = farben.saeule;
  z.fillRect(x, y + 4, b, h - 4);
  z.fillRect(x + 3, y, b - 6, 5); // abgeschrägte "Kappe"

  z.shadowBlur = 0;
  z.fillStyle = farben.hintergrund;
  z.globalAlpha = 0.45;
  for (let sy = y + 14; sy < y + h - 4; sy += 12) z.fillRect(x, sy, b, 2); // Segmentlinien
  z.globalAlpha = 0.8;
  z.fillStyle = mischeMitWeiss(farben.saeule, 0.6);
  z.fillRect(x + b / 2 - 2, y + 8, 4, h - 12); // heller Kern
}

/** Drohne: gedrehtes Quadrat (Raute) mit Auge. Das Auge blinkt (nur ohne reduzierte Bewegung). */
function zeichneDrohne(x, y, b, h, jetzt) {
  const z = zeichner;
  const mx = x + b / 2;
  const my = y + h / 2;

  z.shadowColor = farben.drohne;
  z.shadowBlur = 10;
  z.fillStyle = farben.drohne;
  z.beginPath();
  z.moveTo(x, my);
  z.lineTo(mx, y);
  z.lineTo(x + b, my);
  z.lineTo(mx, y + h);
  z.closePath();
  z.fill();

  z.shadowBlur = 0;
  z.fillStyle = farben.hintergrund; // dunkle Innen-Raute
  z.beginPath();
  z.moveTo(mx - b * 0.22, my);
  z.lineTo(mx, my - h * 0.28);
  z.lineTo(mx + b * 0.22, my);
  z.lineTo(mx, my + h * 0.28);
  z.closePath();
  z.fill();

  const blinken = ruhigerModus ? 1 : 0.55 + 0.45 * Math.sin(jetzt / 130);
  z.globalAlpha = blinken;
  z.fillStyle = farben.rex;
  z.fillRect(mx - 3, my - 3, 6, 6); // leuchtendes Auge

  // Zwei kleine "Flügel"-Striche links und rechts
  z.globalAlpha = 1;
  z.fillStyle = farben.drohne;
  z.fillRect(x - 6, my - 1, 6, 2);
  z.fillRect(x + b, my - 1, 6, 2);
}

/* ---------- Rex ---------- */

/*
   Der Rex ist Pixel-Kunst aus Text: Jede Zeichenkette ist eine Pixelzeile,
   jedes Zeichen ein Quadrat von ZELLE x ZELLE Pixeln.
     #  Körper   s  Rückenstachel   e  Auge   a  Arm   .  leer
   Kopf und Rumpf (Zeilen 0-9) sind immer gleich, nur die Beine wechseln:
   Dadurch sparen wir uns Wiederholung und können Beinvarianten tauschen.
*/
const REX_OBERKOERPER = [
  ".......######.",
  ".......##e####",
  ".......#######",
  ".......#####..",
  ".......####...",
  "..s.s.s####...",
  ".###########..",
  "###########aa.",
  "..#########...",
  "...#######....",
];
const REX_BEINE = {
  stehen: ["...##...##....", "...###..###..."],
  laufA: ["...##...##....", "...###........"],
  laufB: ["...##...##....", "........###..."],
};
const REX_DUCKEN_BILD = {
  laufA: [
    "..s.s.s..#####",
    ".########e####",
    "#############.",
    ".###########..",
    "...##...##....",
    "...###..##....",
  ],
  laufB: [
    "..s.s.s..#####",
    ".########e####",
    "#############.",
    ".###########..",
    "...##...##....",
    "..###....###..",
  ],
};

/** Zeichnet eine Sprite-Tabelle (Array von Zeichenketten) ab Position (x, y). */
function zeichneSprite(zeilen, x, y, augenFarbe) {
  const z = zeichner;
  const farbe = { "#": farben.rex, s: farben.kristall, a: farben.rexHell, e: augenFarbe };
  zeilen.forEach((zeile, zeileNr) => {
    for (let spalte = 0; spalte < zeile.length; spalte++) {
      const zeichen = zeile[spalte];
      if (zeichen === ".") continue;
      z.fillStyle = farbe[zeichen];
      // Math.round: ganze Pixel, sonst blitzen feine Nähte zwischen den Quadraten auf
      z.fillRect(Math.round(x + spalte * ZELLE), Math.round(y + zeileNr * ZELLE), ZELLE, ZELLE);
    }
  });
}

function zeichneRex(jetzt) {
  const z = zeichner;
  const ducken = (tasteDucken || zeigerDucken) && rex.amBoden && phase === "laeuft";
  const sichtbar = rexRechteck(rex, ducken);
  // Beinwechsel an die gelaufene STRECKE koppeln (nicht an die Zeit): Die
  // Schritte passen dann zum Tempo des Bodens, ohne Rutschen.
  const laeuft = rex.amBoden && phase === "laeuft";
  const wechsel = laeuft && Math.floor(strecke / 34) % 2 === 1;

  const tot = phase === "vorbei";
  const augenFarbe = tot ? farben.text : farben.hintergrund;

  z.save();
  z.shadowColor = farben.rex;
  z.shadowBlur = 8;
  if (ducken) {
    zeichneSprite(
      wechsel ? REX_DUCKEN_BILD.laufB : REX_DUCKEN_BILD.laufA,
      sichtbar.x,
      sichtbar.y,
      augenFarbe,
    );
  } else {
    const beine = !laeuft ? REX_BEINE.stehen : wechsel ? REX_BEINE.laufB : REX_BEINE.laufA;
    zeichneSprite([...REX_OBERKOERPER, ...beine], sichtbar.x, sichtbar.y, augenFarbe);
  }
  z.restore();
}

/* ---------- Partikel (Staub und Funken, nur Deko) ---------- */

function staubErzeugen(x, anzahl) {
  if (ruhigerModus) return; // reine Deko → bei reduzierter Bewegung weglassen
  for (let i = 0; i < anzahl; i++) {
    partikel.push({
      x: x + Math.random() * 14,
      y: BODEN_Y - 2,
      vx: -40 - Math.random() * 80,
      vy: -20 - Math.random() * 50,
      leben: 1,
      farbe: farben.gedaempft,
    });
  }
}

function funkenErzeugen() {
  if (ruhigerModus) return;
  const mitteX = REX_X + 24;
  const mitteY = BODEN_Y - rex.hoehe - 24;
  for (let i = 0; i < 18; i++) {
    const winkel = Math.random() * Math.PI * 2;
    const tempo = 60 + Math.random() * 160;
    partikel.push({
      x: mitteX,
      y: mitteY,
      vx: Math.cos(winkel) * tempo,
      vy: Math.sin(winkel) * tempo - 40,
      leben: 1,
      farbe: i % 3 === 0 ? farben.kristall : farben.rex,
    });
  }
}

/** `sekunden` ist die echte Zeit seit dem letzten Frame → gleich schnell auf jedem Gerät. */
function partikelBewegen(sekunden) {
  for (const p of partikel) {
    p.x += p.vx * sekunden;
    p.y += p.vy * sekunden;
    p.vy += 400 * sekunden; // sie fallen leicht nach unten
    p.leben -= sekunden * 2.2; // in ca. 0,45 s ausgeblendet
  }
  partikel = partikel.filter((p) => p.leben > 0);
}

function zeichnePartikel() {
  const z = zeichner;
  z.save();
  for (const p of partikel) {
    z.globalAlpha = Math.max(p.leben, 0);
    z.fillStyle = p.farbe;
    const kante = 1 + 3 * p.leben;
    z.fillRect(Math.round(p.x), Math.round(p.y), kante, kante);
  }
  z.restore();
}

/* ---------- Overlays ---------- */

/** Abgedunkelte Fläche mit zwei Textzeilen (Start- und Pause-Anzeige). */
function zeichneOverlay(titel, untertitel, jetzt) {
  const z = zeichner;
  z.save();
  z.globalAlpha = 0.86;
  z.fillStyle = farben.hintergrund;
  z.fillRect(0, 0, BREITE, HOEHE);

  z.globalAlpha = 1;
  z.textAlign = "center";
  z.textBaseline = "middle";

  z.shadowColor = farben.rex;
  z.shadowBlur = 14;
  z.fillStyle = farben.text;
  z.font = `22px ${farben.schriftPixel}`;
  z.fillText(titel, BREITE / 2, HOEHE / 2 - 16);

  // Die zweite Zeile "atmet" leicht, damit klar ist: Hier wird auf dich gewartet.
  z.shadowBlur = 0;
  z.globalAlpha = ruhigerModus ? 1 : 0.7 + 0.3 * Math.sin(jetzt / 350);
  z.fillStyle = farben.text;
  z.font = `17px ${farben.schriftText}`;
  z.fillText(untertitel, BREITE / 2, HOEHE / 2 + 24);
  z.restore();
}

/**
 * Weißes Aufblitzen nach dem Treffer: dreimal an- und abschwellend.
 * |sin| ist immer positiv und "pocht" dreimal, wenn t von 0 bis 1 läuft.
 * Der Faktor (1 - t) lässt das Aufblitzen gleichzeitig ausklingen.
 */
function zeichneBlitz(jetzt) {
  const t = (jetzt - blitzStart) / BLITZ_DAUER_MS;
  if (t >= 1) return;
  // EIN weicher Puls statt drei: mehr als 3 Blitze pro Sekunde können
  // bei Fotosensibilität Anfälle auslösen (WCAG 2.3.1).
  const staerke = Math.sin(t * Math.PI) * 0.6;
  zeichner.save();
  zeichner.globalAlpha = staerke;
  zeichner.fillStyle = farben.text;
  zeichner.fillRect(0, 0, BREITE, HOEHE);
  zeichner.restore();
}

/* ============================================================
   Start
   ============================================================ */
const wahl = levelWahl({
  spiel: SPIEL,
  titel: "Welt wählen",
  namen: BIOME.map((b) => b.name),
  nach: document.querySelector(".steuerung"),
  gesperrt: () => phase === "laeuft",
  beiWahl: (n) => neuesSpiel(n - 1),
});
neuesSpiel(0);
// Handy: Sprung- und Duck-Taste, Einpassen, Scroll-Sperre, Spielmodus (assets/mobil.js)
spielSeite({
  phase: () => phase,
  gamepad: {
    links: [{ ...TASTE.runter, name: "Ducken", beschriftung: "DUCKEN", breit: true }],
    rechts: [{ ...TASTE.hoch, name: "Springen", beschriftung: "SPRUNG", gross: true }],
  },
});
letzteZeit = performance.now();
requestAnimationFrame(einzelbild);
