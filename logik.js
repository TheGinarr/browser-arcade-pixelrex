/* ============================================================
   PIXELREX · logik.js
   ------------------------------------------------------------
   WARUM EINE EXTRA DATEI?
   Alles in dieser Datei ist "pure Logik": Funktionen, die nur
   rechnen (Zahlen rein, Zahlen/Objekte raus) und weder auf das
   Canvas noch auf die Seite (document) zugreifen. Das hat zwei
   Vorteile:
     1. Man kann sie ohne Browser testen (z. B. mit node), weil
        sie keine Seite brauchen.
     2. Wer die Spielregeln verstehen will, muss nicht durch
        Zeichencode scrollen.
   game.js importiert alles von hier und kümmert sich nur um
   Eingabe, Schleife und Zeichnen.

   KOORDINATEN: Das Canvas ist 640 x 240 Pixel groß, (0|0) ist
   OBEN links, y wächst nach UNTEN (wie überall am Bildschirm).
   Der Boden liegt bei y = BODEN_Y. Für den Rex rechnen wir die
   Sprunghöhe dagegen "nach oben" (hoehe > 0 = in der Luft),
   weil sich Physik so natürlicher denken lässt.
   ============================================================ */

/* ---------- Spielfeld ---------- */
export const BREITE = 640;
export const HOEHE = 240;
export const BODEN_Y = 190; // y-Koordinate der Bodenlinie
export const REX_X = 72; // der Rex bleibt links stehen, die Welt läuft an ihm vorbei

/* ---------- Rex: sichtbare Größe (Pixel auf dem Canvas) ---------- */
export const REX_STEHEN = { b: 56, h: 44 };
export const REX_DUCKEN = { b: 56, h: 24 };

/* ---------- Physik ---------- */
export const GRAVITATION = 2400; // Pixel pro Sekunde² (zieht nach unten)
export const SPRUNG_V = 760; // Startgeschwindigkeit nach oben beim Absprung (px/s)
export const SPRUNG_KAPPE_V = 560; // wer die Taste früh loslässt, wird auf dieses Tempo gebremst
export const SCHNELLFALL = 2.2; // Ducken in der Luft: Fallbeschleunigung x 2,2

/* ---------- Tempo und Punkte ---------- */
export const START_TEMPO = 260; // Pixel pro Sekunde zu Beginn
export const TEMPO_ANSTIEG = 5; // so viel schneller wird es pro Sekunde (px/s je s)
export const MAX_TEMPO = 600; // schneller wird es nie
export const EINHEITEN_PRO_PUNKT = 10; // 10 gelaufene Pixel = 1 Punkt ("1 m")

/* ---------- Hindernisse ---------- */
export const REAKTIONSZEIT = 0.2; // Sekunden Puffer nach der Landung (siehe mindestAbstand)
export const ZUSATZ_ZEIT_MAX = 0.9; // bis zu so viele Sekunden extra Lücke, zufällig
export const DROHNEN_AB_PUNKTEN = 300; // Drohnen tauchen erst nach 300 m auf
export const DREIER_GRUPPEN_AB_PUNKTEN = 400;
export const DROHNE_TIEF = 26; // Abstand Drohnen-Unterkante zum Boden (ducken oder drüber springen)
export const DROHNE_HOCH = 62; // hoch: einfach drunter durchlaufen, nicht springen!

/* ---------- Hitbox-Verkleinerung (Fairness) ---------- */
export const RAND_REX = 8;
export const RAND_KRISTALL = 3;
export const RAND_DROHNE = 4;

/* ============================================================
   Tempo, Punkte, Sprungdauer
   ============================================================ */

/** Tempo in Pixel pro Sekunde nach `sekunden` Spielzeit: linear steigend, gedeckelt. */
export function tempoNachZeit(sekunden) {
  return Math.min(MAX_TEMPO, START_TEMPO + TEMPO_ANSTIEG * sekunden);
}

/** Gelaufene Strecke (Pixel) -> Punkte. Abgerundet, damit die Anzeige nie "vorauseilt". */
export function punkteAusStrecke(strecke) {
  return Math.floor(strecke / EINHEITEN_PRO_PUNKT);
}

/**
 * Wie lange dauert ein voller Sprung (Absprung bis Landung)?
 * Aus der Physik: Die Startgeschwindigkeit wird von der Gravitation
 * abgebremst (bis zum höchsten Punkt) und danach wieder
 * beschleunigt (zurück zum Boden). Hin und zurück: 2 * v / g.
 */
export function luftzeit() {
  return (2 * SPRUNG_V) / GRAVITATION;
}

/** Höhe des höchsten Punktes eines vollen Sprungs (Energieerhaltung: v² / 2g). */
export function sprunghoehe() {
  return (SPRUNG_V * SPRUNG_V) / (2 * GRAVITATION);
}

/* ============================================================
   Rex-Physik
   ============================================================ */

/** Frischer Rex: steht auf dem Boden. `hoehe` = Abstand der Füße zum Boden, `v` = Tempo nach OBEN. */
export function neuerRex() {
  return { hoehe: 0, v: 0, amBoden: true };
}

/** Startet einen Sprung, aber nur vom Boden aus (kein Doppelsprung). Gibt true zurück, wenn er klappte. */
export function sprungStarten(rex) {
  if (!rex.amBoden) return false;
  rex.v = SPRUNG_V;
  rex.amBoden = false;
  return true;
}

/**
 * "Taste wurde losgelassen": Ein noch steigender Rex wird auf SPRUNG_KAPPE_V
 * gebremst. Kurzes Tippen = kleiner Hüpfer, Halten = voller Sprung.
 */
export function sprungKappen(rex) {
  if (!rex.amBoden && rex.v > SPRUNG_KAPPE_V) rex.v = SPRUNG_KAPPE_V;
}

/**
 * Ein Physikschritt von `dt` Sekunden. Gibt true zurück, wenn der Rex in
 * diesem Schritt gelandet ist (game.js nutzt das für den Staub-Effekt).
 */
export function rexSchritt(rex, dt, ducken) {
  if (rex.amBoden) return false;
  // Schnellfall nur beim FALLEN (v < 0). Wer beim Steigen duckt, soll
  // den Sprung nicht verlieren.
  const g = GRAVITATION * (ducken && rex.v < 0 ? SCHNELLFALL : 1);
  rex.v -= g * dt; // Gravitation bremst/beschleunigt ...
  rex.hoehe += rex.v * dt; // ... und die Geschwindigkeit verschiebt die Position
  if (rex.hoehe <= 0) {
    rex.hoehe = 0;
    rex.v = 0;
    rex.amBoden = true;
    return true;
  }
  return false;
}

/* ============================================================
   Kollision (AABB = Axis-Aligned Bounding Box)
   ============================================================ */

/**
 * Überlappen sich zwei Rechtecke? Ein Rechteck ist {x, y, b, h}
 * (links, oben, Breite, Höhe) und liegt achsenparallel (nicht gedreht).
 *
 * Trick: Zwei solche Rechtecke überlappen sich genau dann, wenn sie sich
 * auf BEIDEN Achsen überlappen. Auf einer Achse überlappen sie sich nicht,
 * sobald eines komplett links/rechts (bzw. über/unter) dem anderen liegt.
 * Wir prüfen mit "<" und ">" (strikt): Wer nur mit der Kante berührt,
 * zählt NICHT als Treffer. Das ist im Zweifel die fairere Entscheidung.
 */
export function ueberlappt(a, b) {
  return a.x < b.x + b.b && a.x + a.b > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * Schrumpft ein Rechteck rundum um `rand` Pixel.
 *
 * WARUM? Ein Sprite hat Ecken und Lücken (Schwanz, Stacheln, Spitze eines
 * Kristalls), die Hitbox ist aber ein Vollrechteck. Würde man das volle
 * Rechteck nehmen, stürbe man, obwohl man optisch noch Luft zum Hindernis
 * hatte. Das fühlt sich unfair an ("Da war doch nichts!"). Umgekehrt
 * verzeiht man gern einen Treffer, der knapp ausgeht. Deshalb: Hitboxen
 * leicht kleiner als die Grafik. Breite/Höhe bleiben mindestens 1.
 */
export function verkleinern(r, rand) {
  const b = Math.max(1, r.b - 2 * rand);
  const h = Math.max(1, r.h - 2 * rand);
  return { x: r.x + (r.b - b) / 2, y: r.y + (r.h - h) / 2, b, h };
}

/** Sichtbares Rechteck des Rex (nicht verkleinert). Duckt nur am Boden. */
export function rexRechteck(rex, ducken) {
  const groesse = ducken && rex.amBoden ? REX_DUCKEN : REX_STEHEN;
  return { x: REX_X, y: BODEN_Y - rex.hoehe - groesse.h, b: groesse.b, h: groesse.h };
}

/** Hitbox des Rex = sichtbares Rechteck, rundum verkleinert. */
export function rexHitbox(rex, ducken) {
  return verkleinern(rexRechteck(rex, ducken), RAND_REX);
}

/** Sichtbares Rechteck eines Hindernis-Teils in Weltkoordinaten. */
export function teilRechteck(hindernis, teil) {
  return { x: hindernis.x + teil.dx, y: BODEN_Y - teil.dy - teil.h, b: teil.b, h: teil.h };
}

/** Hitbox eines einzelnen Hindernis-Teils (Drohnen etwas großzügiger verkleinert). */
export function teilHitbox(hindernis, teil) {
  const rand = hindernis.art === "drohne" ? RAND_DROHNE : RAND_KRISTALL;
  return verkleinern(teilRechteck(hindernis, teil), rand);
}

/** Trifft die Rex-Hitbox irgendein Teil des Hindernisses? */
export function kollidiertMitHindernis(rexBox, hindernis) {
  return hindernis.teile.some((teil) => ueberlappt(rexBox, teilHitbox(hindernis, teil)));
}

/* ============================================================
   Hindernisse erzeugen und platzieren
   ============================================================ */

/**
 * Kleinster erlaubter Abstand (in Pixeln) zwischen dem Ende eines
 * Hindernisses und dem Anfang des nächsten.
 *
 * WARUM SKALIERT DER ABSTAND MIT DEM TEMPO?
 * Ein Sprung dauert immer gleich lang (luftzeit() ≈ 0,63 s), egal wie
 * schnell die Welt läuft. In dieser Zeit legt der Rex aber bei Tempo 260
 * nur 165 Pixel zurück, bei Tempo 600 dagegen 380 Pixel. Würde man eine
 * FESTE Pixel-Lücke nehmen (z. B. 200 px), wäre sie bei niedrigem Tempo
 * großzügig, bei hohem Tempo aber kürzer als ein einziger Sprung:
 * Der Rex landet noch nicht wieder, wenn das nächste Hindernis schon da
 * ist. Das wäre unschaffbar. Darum rechnen wir die Lücke in ZEIT
 * (Luftzeit + kleine Reaktionszeit) und wandeln sie mit
 *     Strecke = Tempo * Zeit
 * in Pixel um.
 */
export function mindestAbstand(tempo) {
  return tempo * (luftzeit() + REAKTIONSZEIT);
}

/**
 * Tatsächlicher Abstand zum nächsten Hindernis: Mindestabstand plus
 * ein zufälliger Zuschlag. `zufall` ist eine Zahl von 0 (inklusive)
 * bis 1 (exklusive), z. B. von Math.random(). Als Parameter übergeben
 * (statt Math.random() hier drin) lässt sich die Funktion exakt testen.
 */
export function naechsterAbstand(tempo, zufall) {
  return mindestAbstand(tempo) + zufall * tempo * ZUSATZ_ZEIT_MAX;
}

/**
 * Baut ein zufälliges Hindernis (ohne Position, die setzt game.js).
 * `zufallsquelle` ist eine Funktion, die bei jedem Aufruf eine Zahl in
 * [0, 1) liefert (im Spiel: Math.random, im Test: ein festes Skript).
 *
 * Ein Hindernis besteht aus einem oder mehreren "Teilen". Jeder Teil
 * ist ein Rechteck relativ zum Hindernis:
 *   dx = Abstand von der linken Kante des Hindernisses
 *   dy = Schwebehöhe über dem Boden (0 = steht auf dem Boden)
 *   b, h = Breite und Höhe
 */
/* ---------- Welten (Biome) ----------
   Alle paar hundert Meter wechselt die Welt: neue Farben und ab der
   dritten Welt neue Hindernisse. Nach der letzten bleibt es dort,
   das Tempo steigt weiter. Wer eine Welt erreicht hat, kann sie
   später direkt anwählen (Level-Auswahl). */
export const BIOME = [
  { name: "Kristallwüste", ab: 0 },
  { name: "Abendsonne", ab: 250 },
  { name: "Vulkan", ab: 500, lava: true },
  { name: "Eishöhle", ab: 800, eis: true },
  { name: "Sternennacht", ab: 1100, lava: true, eis: true },
];

/** Index der Welt für den Punktestand (nie unter der gewählten Start-Welt). */
export function biomIndex(punkte, start = 0) {
  let index = 0;
  BIOME.forEach((b, i) => {
    if (punkte >= b.ab) index = i;
  });
  return Math.max(index, start);
}

export const EISZAPFEN_LUECKE = 30; // so hoch über dem Boden endet ein Eiszapfen: nur Ducken passt drunter

export function hindernisErzeugen(punkte, zufallsquelle, biom = BIOME[0]) {
  const zufall = zufallsquelle;
  const drohnenErlaubt = punkte >= DROHNEN_AB_PUNKTEN;

  // Eiszapfen hängen von oben bis knapp über den Boden: Springen hilft
  // nicht, nur Ducken (geduckt ist der Rex 24 px hoch, die Lücke 30 px).
  if (biom.eis && zufall() < 0.18) {
    return {
      art: "eiszapfen",
      x: 0,
      breite: 22,
      teile: [{ dx: 0, dy: EISZAPFEN_LUECKE, b: 22, h: BODEN_Y - EISZAPFEN_LUECKE }],
    };
  }
  // Lava: flach, aber breit. Ein normaler Sprung reicht, nur nicht zu früh.
  if (biom.lava && zufall() < 0.2) {
    const b = 48 + Math.floor(zufall() * 26); // 48 bis 73
    return { art: "lava", x: 0, breite: b, teile: [{ dx: 0, dy: 0, b, h: 9 }] };
  }

  if (drohnenErlaubt && zufall() < 0.25) {
    const dy = zufall() < 0.5 ? DROHNE_TIEF : DROHNE_HOCH;
    return { art: "drohne", x: 0, breite: 44, teile: [{ dx: 0, dy, b: 44, h: 26 }] };
  }

  if (zufall() < 0.3) {
    // Einzelne hohe Energiesäule
    const h = 52 + Math.floor(zufall() * 15); // 52 bis 66
    return { art: "saeule", x: 0, breite: 22, teile: [{ dx: 0, dy: 0, b: 22, h }] };
  }

  // Kristall-Gruppe: 1 bis 2 Stück, später bis 3.
  // Breite Gruppen sind bei niedrigem Tempo schwer, weil der Sprung dann
  // weniger Strecke "über" dem Hindernis schafft. Darum erst später.
  const maxAnzahl = punkte >= DREIER_GRUPPEN_AB_PUNKTEN ? 3 : 2;
  const anzahl = 1 + Math.floor(zufall() * maxAnzahl);
  const teile = [];
  let dx = 0;
  for (let i = 0; i < anzahl; i++) {
    const b = 20 + Math.floor(zufall() * 7); // 20 bis 26
    const h = 34 + Math.floor(zufall() * 25); // 34 bis 58
    teile.push({ dx, dy: 0, b, h });
    dx += b + 3; // 3 px Lücke zwischen den Kristallen
  }
  return { art: "kristall", x: 0, breite: dx - 3, teile };
}
