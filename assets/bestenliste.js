/* ============================================================
   bestenliste.js · Öffentliche Topliste (Spiele-Server CT112)
   ------------------------------------------------------------
   Neben der lokalen Top-3-Liste (storage.js) gibt es eine
   weltweite Topliste: Pro Gerät und Spiel speichert der Server
   nur den BESTWERT – mit den Initialen, dem Datum und einer
   zufälligen Geräte-ID. Keine IP-Adresse, kein Name, keine Cookies.

   GERÄTE-ID: beim ersten Eintrag einmal zufällig erzeugt
   (crypto.getRandomValues) und in localStorage ba:konto:id
   gemerkt. Sie verknüpft nur "deine" Einträge, damit der Server
   weiß, welcher Bestwert dir gehört (und "Meine Einträge löschen"
   funktioniert). Wer den Browser-Speicher leert, bekommt eine neue.

   ROBUST: Ist der Server nicht erreichbar, läuft alles wie
   vorher mit der lokalen Liste weiter – Fehler werden geschluckt.
   ============================================================ */

import { lade, speichere, entferne } from "./storage.js";

const API = "/api"; // nginx leitet /api/ an den Spiele-Server weiter (absoluter Pfad, gilt auch in Unterordnern)
const ZWISCHENSPEICHER_MS = 30_000;
const cache = new Map(); // spiel -> { zeit, daten }

/** Liefert die Geräte-ID; legt sie mit `anlegen` bei Bedarf an. */
export function geraeteId(anlegen = false) {
  let id = lade("konto", "id", null);
  if (typeof id === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(id)) return id;
  if (!anlegen) return null;
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  id = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return speichere("konto", "id", id) ? id : null; // ohne Speicher keine Teilnahme
}

async function anfrage(methode, pfad, koerper) {
  const antwort = await fetch(API + pfad, {
    method: methode,
    headers: koerper ? { "Content-Type": "application/json" } : undefined,
    body: koerper ? JSON.stringify(koerper) : undefined,
    keepalive: methode !== "GET", // Eintrag kommt auch an, wenn die Seite gleich verlassen wird
    cache: "no-store",
  });
  if (!antwort.ok) throw new Error(`HTTP ${antwort.status}`);
  return antwort.json();
}

function merken(spiel, daten) {
  cache.set(spiel, { zeit: Date.now(), daten });
  window.dispatchEvent(new CustomEvent("bestenliste", { detail: { spiel, daten } }));
  return daten;
}

/** Weltweite Top 10 + eigener Bestwert. Gibt null zurück, wenn der Server fehlt. */
export async function holen(spiel, frisch = false) {
  const c = cache.get(spiel);
  if (!frisch && c && Date.now() - c.zeit < ZWISCHENSPEICHER_MS) return c.daten;
  try {
    const id = geraeteId();
    return merken(
      spiel,
      await anfrage("GET", `/topliste/${encodeURIComponent(spiel)}${id ? `?id=${id}` : ""}`),
    );
  } catch {
    return null;
  }
}

/** Zuletzt geladener Stand ohne neue Anfrage (oder null). */
export function zwischengespeichert(spiel) {
  return cache.get(spiel)?.daten ?? null;
}

/**
 * Meldet einen Wert. Gesendet wird nur, wenn er den bisher gemeldeten
 * eigenen Bestwert schlägt – so bleibt es bei wenigen Anfragen, auch
 * wenn ein Casino-Spiel nach jedem Gewinn stillEintragen() aufruft.
 */
export function melden(spiel, punkte, initialen, richtung = "hoch") {
  if (!Number.isInteger(punkte) || punkte < 1) return;
  const bisher = lade("konto", `pb:${spiel}`, null);
  if (bisher !== null && (richtung === "hoch" ? punkte <= bisher : punkte >= bisher)) return;
  const id = geraeteId(true);
  if (!id) return;
  speichere("konto", `pb:${spiel}`, punkte);
  anfrage("POST", `/topliste/${encodeURIComponent(spiel)}`, { id, initialen, punkte })
    .then((d) => merken(spiel, d))
    .catch(() => entferne("konto", `pb:${spiel}`)); // beim nächsten Mal erneut versuchen
}

/*
 * NACHMELDEN: Rekorde, die vor der weltweiten Liste entstanden sind (oder
 * deren Meldung fehlschlug), liegen nur lokal. Einmal pro Sitzung – auf
 * jeder Seite, auch der Startseite – werden sie nachgereicht. Gesendet
 * wird nur, was noch nicht gemeldet ist; nach den ersten fünf mit Pause,
 * damit die Schreib-Grenze des Servers (10/min) nicht greift.
 * Richtung je Spiel wie im SPIELE-Dict von server.py (neue Spiele eintragen!).
 */
const RUNTER = new Set([
  "zahlenraten",
  "minesweeper-leicht",
  "minesweeper-mittel",
  "minesweeper-schwer",
  "sudoku-leicht",
  "sudoku-mittel",
  "sudoku-schwer",
  "solitaer-1",
  "solitaer-3",
]);
const HOCH = new Set([
  "2048",
  "mauerbrecher",
  "flattervogel",
  "froschsprung",
  "meteorsturm",
  "pixelrex",
  "snake",
  "wortfuchs",
  "poker",
  "coinflip",
  "higher-lower",
  "zuckerzauber",
  "waesche",
  "regale",
  "gewuerze",
  "slots",
  "angelglueck",
  "tempelschatz",
  "blackjack",
  "risikoleiter",
  "rubbellos",
  "coinflip-casino",
  "higher-lower-casino",
  "viererreihe",
  "schach",
  "ludo",
]);
export function allesNachmelden() {
  try {
    if (sessionStorage.getItem("ba:nachgemeldet")) return;
    sessionStorage.setItem("ba:nachgemeldet", "1");
  } catch {
    return;
  }
  const kuerzel = String(lade("global", "initialen", "")).slice(0, 3) || "???";
  const offen = [];
  const pruefen = (spiel, punkte, initialen, richtung) => {
    if (!Number.isInteger(punkte) || punkte < 1) return;
    const bisher = lade("konto", `pb:${spiel}`, null);
    if (bisher !== null && (richtung === "hoch" ? punkte <= bisher : punkte >= bisher)) return;
    offen.push([spiel, punkte, initialen, richtung]);
  };
  for (const spiel of [...HOCH, ...RUNTER]) {
    const liste = lade(spiel, "topliste", []);
    if (!Array.isArray(liste) || !liste.length) continue;
    const richtung = RUNTER.has(spiel) ? "runter" : "hoch";
    const punkte = liste.map((e) => Number(e?.punkte)).filter(Number.isInteger);
    if (!punkte.length) continue;
    const bester = richtung === "hoch" ? Math.max(...punkte) : Math.min(...punkte);
    const e = liste.find((x) => Number(x?.punkte) === bester);
    pruefen(spiel, bester, kuerzelSaeubern(e?.initialen) || kuerzel, richtung);
  }
  const konto = Number(lade("casino", "hoechsterKontostand", 0));
  if (konto > 1000) pruefen("casino-kontostand", konto, kuerzel, "hoch"); // 1.000 = Startgeld, kein Rekord
  offen.forEach(([spiel, punkte, initialen, richtung], i) =>
    setTimeout(
      () => melden(spiel, punkte, initialen, richtung),
      i < 5 ? i * 300 : 1500 + (i - 4) * 7000,
    ),
  );
}

/** Ändert die Initialen des eigenen Eintrags in einem Spiel. */
export function initialenMelden(spiel, initialen) {
  const id = geraeteId();
  if (!id || lade("konto", `pb:${spiel}`, null) === null) return;
  anfrage("PATCH", `/topliste/${encodeURIComponent(spiel)}`, { id, initialen })
    .then((d) => merken(spiel, d))
    .catch(() => {});
}

/** Säubert ein Kürzel wie storage.js (max. 3 Zeichen, A–Z, 0–9, ÄÖÜ). */
export function kuerzelSaeubern(roh) {
  return String(roh || "")
    .toUpperCase()
    .replace(/[^A-Z0-9ÄÖÜ]/g, "")
    .slice(0, 3);
}

/**
 * Benennt dich überall um: merkt das Kürzel, ändert die lokalen
 * Top-3-Einträge mit dem alten Kürzel und – mit EINER Anfrage – alle
 * deine Einträge auf dem Server. Danach werden alle angezeigten
 * Listen neu geladen. Gibt die Zahl der geänderten Server-Einträge
 * zurück (null, wenn der Server nicht erreichbar war).
 */
export async function ueberallUmbenennen(neu, { lokal = true } = {}) {
  const kuerzel = kuerzelSaeubern(neu);
  if (!kuerzel) return null;
  const alt = kuerzelSaeubern(lade("global", "initialen", ""));
  speichere("global", "initialen", kuerzel);
  const geaendertLokal = new Set();
  if (lokal && alt && alt !== kuerzel) {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const m = /^ba:(.+):topliste$/.exec(localStorage.key(i) || "");
        if (!m) continue;
        const liste = lade(m[1], "topliste", []);
        if (!Array.isArray(liste)) continue;
        let anders = false;
        for (const e of liste)
          if (e && e.initialen === alt) {
            e.initialen = kuerzel;
            anders = true;
          }
        if (anders) {
          speichere(m[1], "topliste", liste);
          geaendertLokal.add(m[1]);
        }
      }
    } catch {
      /* bewusst ignoriert */
    }
  }
  for (const spiel of geaendertLokal)
    window.dispatchEvent(new CustomEvent("bestenliste", { detail: { spiel } }));
  const id = geraeteId();
  if (!id) return 0;
  let n = null;
  try {
    n = (await anfrage("PATCH", "/meine-daten", { id, initialen: kuerzel })).geaendert;
  } catch {
    return null;
  }
  await Promise.all([...cache.keys()].map((spiel) => holen(spiel, true)));
  return n;
}

/** Löscht alle eigenen Einträge auf dem Server und vergisst die Geräte-ID. */
export async function meineDatenLoeschen() {
  const id = geraeteId();
  let geloescht = 0;
  if (id) geloescht = (await anfrage("DELETE", `/meine-daten?id=${id}`)).geloescht;
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith("ba:konto:")) localStorage.removeItem(k);
    }
  } catch {
    /* bewusst ignoriert */
  }
  cache.clear();
  return geloescht;
}

/* Knöpfe mit data-topliste-loeschen (Startseite, Datenschutz) */
for (const knopf of document.querySelectorAll("[data-topliste-loeschen]")) {
  const meldung = document.querySelector(knopf.dataset.toplisteLoeschen);
  knopf.addEventListener("click", async () => {
    if (!confirm("Alle deine Einträge in der öffentlichen Topliste löschen?")) return;
    knopf.disabled = true;
    try {
      const n = await meineDatenLoeschen();
      if (meldung)
        meldung.textContent = n
          ? `Erledigt: ${n} Einträge gelöscht.`
          : "Erledigt: Es gab keine Einträge von diesem Gerät.";
    } catch {
      if (meldung)
        meldung.textContent =
          "Das hat nicht geklappt – der Server ist gerade nicht erreichbar. Bitte später nochmal.";
    }
    knopf.disabled = false;
  });
}

// Beim Laden jeder Seite (Startseite und Spiele) einmal pro Sitzung
setTimeout(allesNachmelden, 1500);
