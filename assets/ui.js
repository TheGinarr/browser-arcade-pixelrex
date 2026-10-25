/* ============================================================
   ui.js · Gemeinsame UI-Bausteine für alle Spiele
   ------------------------------------------------------------
   Hier liegt alles, was mehrere Spiele brauchen, aber nichts
   mit der Spiellogik zu tun hat:
     - bewegungReduziert()  → Animations-Wunsch des Nutzers
     - zahlHochzaehlen()    → weicher Zähler-Ticker fürs HUD
     - toplisteAnzeigen()   → Top-3-Liste als HTML rendern
     - gameOverDialog()     → fertiger Dialog inkl. Initialen-
                              Eingabe und Topliste
   Die Spiele importieren daraus nur, was sie brauchen:
     import { gameOverDialog } from "../assets/ui.js";
   ============================================================ */

import {
  topliste,
  waereInTopliste,
  inToplisteEintragen,
  initialenAendern,
  lade,
  speichere,
} from "./storage.js";
import { spruchFuer } from "./sprueche.js";
import * as BL from "./bestenliste.js";
import * as FS from "./fortschritt.js";
// Namespace-Import: eine noch zwischengespeicherte ältere bestenliste.js
// ohne ueberallUmbenennen bricht so nicht das ganze Modul.
const { holen, melden, zwischengespeichert } = BL;
const kuerzelSaeubern = (roh) =>
  String(roh || "")
    .toUpperCase()
    .replace(/[^A-Z0-9ÄÖÜ]/g, "")
    .slice(0, 3);
function ueberallUmbenennen(neu, optionen) {
  if (BL.ueberallUmbenennen) return BL.ueberallUmbenennen(neu, optionen);
  speichere("global", "initialen", kuerzelSaeubern(neu));
  return Promise.resolve(null);
}

/**
 * true, wenn der Nutzer im Betriebssystem "Bewegung reduzieren"
 * aktiviert hat. CSS-Animationen schaltet style.css dann schon
 * selbst ab – Spiele nutzen diese Funktion zusätzlich für
 * JS-gesteuerte Effekte (Partikel, Kamera-Shake, Zähler-Ticker …).
 */
export function bewegungReduziert() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Lässt eine Zahl in einem Element weich von ihrem alten Wert zum
 * neuen hochticken (z. B. Punkte im HUD). Bei reduzierter Bewegung
 * wird der Wert einfach direkt gesetzt.
 *
 * requestAnimationFrame ruft `schritt` einmal pro Bildschirm-Frame
 * auf (meist 60×/Sek.) – das ist die Standard-Technik für flüssige
 * JS-Animationen, weil der Browser das Timing selbst optimiert.
 */
export function zahlHochzaehlen(element, zielWert, dauerMs = 400) {
  const startWert = Number(element.textContent.replace(/[^\d-]/g, "")) || 0;
  if (bewegungReduziert() || startWert === zielWert) {
    element.textContent = zielWert;
    return;
  }
  const startZeit = performance.now();
  function schritt(jetzt) {
    // fortschritt läuft von 0 → 1
    const fortschritt = Math.min((jetzt - startZeit) / dauerMs, 1);
    // "easeOut": am Anfang schnell, am Ende sanft auslaufend
    const eased = 1 - Math.pow(1 - fortschritt, 3);
    element.textContent = Math.round(startWert + (zielWert - startWert) * eased);
    if (fortschritt < 1) requestAnimationFrame(schritt);
  }
  requestAnimationFrame(schritt);
}

/**
 * Trägt einen Rekord STILL in die Topliste ein – ohne Dialog, ohne
 * Aufforderung. Verwendet die zuletzt benutzten Initialen (oder "???").
 * Gibt den erreichten Platz (1–3) zurück, sonst null.
 * Die Casino-Spiele nutzen das nach einem großen Gewinn: Die Topliste
 * auf der Seite aktualisiert sich einfach, mehr passiert nicht.
 */
export function stillEintragen(spiel, punkte, richtung = "hoch") {
  const zaehlt = richtung === "hoch" ? punkte > 0 : true;
  if (!zaehlt) return null;
  const initialen = String(lade("global", "initialen", "")).slice(0, 3) || "???";
  // Öffentliche Topliste: meldet nur neue eigene Bestwerte (siehe bestenliste.js)
  melden(spiel, punkte, initialen, richtung);
  if (!waereInTopliste(spiel, punkte, richtung)) return null;
  return inToplisteEintragen(spiel, initialen, punkte, richtung);
}

/* Casino-Spiele bekommen in der Topliste zusätzlich den Reiter "Höchster Kontostand" */
const CASINO_LISTEN = new Set([
  "slots",
  "angelglueck",
  "tempelschatz",
  "blackjack",
  "risikoleiter",
  "rubbellos",
  "poker",
  "coinflip-casino",
  "higher-lower-casino",
]);
const KONTOSTAND = "casino-kontostand";
const zahlDe = (p) => Number(p).toLocaleString("de-DE");
// Offene Toplisten-Anzeigen: aktualisieren sich, sobald neue Server-Daten da sind
const anzeigen = new Set();
window.addEventListener("bestenliste", (e) => {
  for (const a of anzeigen) {
    if (!a.container.isConnected) anzeigen.delete(a);
    else if (a.listenSpiel() === e.detail.spiel) a.zeichnen();
  }
});

function zeileBauen(platzText, initialen, wert, klassen = []) {
  // textContent statt innerHTML für die Werte → Einträge (auch die
  // anderer Leute vom Server) werden nie als HTML interpretiert.
  const li = document.createElement("li");
  li.classList.add(...klassen);
  const platz = document.createElement("span");
  platz.className = "platz";
  platz.textContent = platzText;
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = initialen;
  const punkte = document.createElement("span");
  punkte.className = "punkte";
  punkte.textContent = wert;
  li.append(platz, name, punkte);
  return li;
}

function leerZeile(text) {
  const li = document.createElement("li");
  li.className = "leer";
  li.textContent = text;
  return li;
}

/**
 * Rendert die Topliste eines Spiels in einen Container – mit Reitern:
 *   "Weltweit"      Top 10 vom Spiele-Server + dein Bestwert mit Platz
 *   "Dieses Gerät"  die lokale Top-3-Liste (wie früher, geht auch offline)
 *   "Höchster Kontostand" (nur Casino) – weltweite Top 10 des Kontostands
 * `formatierer` darf die Punktzahl hübsch machen (z. B. "12 Versuche").
 * `hervorhebenPlatz` (1–3) markiert einen frisch eingetragenen lokalen Platz.
 * Ist der Server nicht erreichbar, steht "Dieses Gerät" vorne.
 */
export function toplisteAnzeigen(
  container,
  spiel,
  formatierer = (p) => String(p),
  hervorhebenPlatz = null,
) {
  for (const a of anzeigen) if (a.container === container) anzeigen.delete(a);
  const reiter = [
    { id: "welt", text: "Weltweit", liste: spiel, format: formatierer },
    { id: "lokal", text: "Dieses Gerät", liste: spiel, format: formatierer },
  ];
  if (CASINO_LISTEN.has(spiel)) {
    reiter.push({ id: "konto", text: "Höchster Kontostand", liste: KONTOSTAND, format: zahlDe });
  }
  let aktiv =
    container.dataset.reiter && reiter.some((r) => r.id === container.dataset.reiter)
      ? container.dataset.reiter
      : "welt";

  container.innerHTML = ""; // alten Inhalt leeren
  const leiste = document.createElement("div");
  leiste.className = "topliste-reiter";
  leiste.setAttribute("role", "group");
  leiste.setAttribute("aria-label", "Topliste wählen");
  const knoepfe = reiter.map((r) => {
    const k = document.createElement("button");
    k.type = "button";
    k.textContent = r.text;
    k.addEventListener("click", () => {
      aktiv = r.id;
      container.dataset.reiter = r.id;
      eintrag.zeichnen();
      holen(r.liste).then(() => {});
    });
    leiste.append(k);
    return k;
  });
  const ul = document.createElement("ul");
  ul.className = "topliste";
  const fuss = document.createElement("p");
  fuss.className = "topliste-fuss";
  container.append(leiste, ul, fuss);
  if (!container.dataset.ohneName) container.append(namensFeld()); // im Rekord-Dialog gibt es schon ein Feld

  const eintrag = {
    container,
    listenSpiel: () => reiter.find((r) => r.id === aktiv).liste,
    zeichnen() {
      const r = reiter.find((x) => x.id === aktiv);
      // Nur beim ersten Zeichnen einblenden, Aktualisierungen ohne Flackern
      if (this.gezeichnet) ul.classList.add("ruhig");
      this.gezeichnet = true;
      knoepfe.forEach((k, i) => k.setAttribute("aria-pressed", String(reiter[i].id === aktiv)));
      ul.innerHTML = "";
      fuss.textContent = "";
      const daten = r.id === "lokal" ? null : zwischengespeichert(r.liste);
      if (r.id === "lokal" || !daten) {
        if (r.id === "konto") {
          const bester = lade("casino", "hoechsterKontostand", 0);
          ul.append(leerZeile("Weltweite Liste gerade nicht erreichbar."));
          fuss.textContent = `Dein bester Kontostand: ${zahlDe(bester)}`;
          return;
        }
        if (r.id === "welt")
          fuss.textContent =
            "Weltweite Liste gerade nicht erreichbar – hier deine Einträge auf diesem Gerät.";
        const liste = topliste(spiel);
        if (liste.length === 0) ul.append(leerZeile("Noch keine Einträge – sei die/der Erste!"));
        liste.forEach((e, i) =>
          ul.append(
            zeileBauen(
              `${i + 1}.`,
              e.initialen,
              r.format(e.punkte),
              hervorhebenPlatz === i + 1 ? ["neu"] : [],
            ),
          ),
        );
        return;
      }
      if (daten.top.length === 0) ul.append(leerZeile("Noch keine Einträge – sei die/der Erste!"));
      daten.top.forEach((e, i) =>
        ul.append(
          zeileBauen(`${i + 1}.`, e.initialen, r.format(e.punkte), e.du ? ["neu", "du"] : []),
        ),
      );
      if (daten.eigen) {
        fuss.textContent =
          daten.eigen.platz <= daten.top.length
            ? `Du bist auf Platz ${daten.eigen.platz} von ${daten.anzahl}.`
            : `Dein Bestwert: ${r.format(daten.eigen.punkte)} (Platz ${daten.eigen.platz} von ${daten.anzahl})`;
      } else {
        fuss.textContent = daten.anzahl ? `${daten.anzahl} Einträge weltweit` : "";
      }
    },
  };
  anzeigen.add(eintrag);
  eintrag.zeichnen();

  // Server-Stand holen; bestehende Rekorde von früher einmalig nachmelden
  const initialen = String(lade("global", "initialen", "")).slice(0, 3) || "???";
  holen(spiel).then((d) => {
    const lokalBester = topliste(spiel)[0];
    if (d && lokalBester)
      melden(spiel, lokalBester.punkte, lokalBester.initialen || initialen, d.richtung);
  });
  if (CASINO_LISTEN.has(spiel)) {
    holen(KONTOSTAND);
    const bester = lade("casino", "hoechsterKontostand", 0);
    if (bester > 1000) melden(KONTOSTAND, bester, initialen);
  }
}

/**
 * Kleine Zeile "Dein Kürzel: [___] Ändern" unter jeder Topliste.
 * Benennt alle eigenen Einträge (lokal + weltweit) auf einmal um.
 */
let namensNr = 0;
function namensFeld() {
  const form = document.createElement("form");
  form.className = "topliste-name";
  const id = `topliste-name-${++namensNr}`;
  const label = document.createElement("label");
  label.htmlFor = id;
  label.textContent = "Dein Kürzel:";
  const eingabe = document.createElement("input");
  eingabe.id = id;
  eingabe.className = "initialen klein";
  eingabe.maxLength = 3;
  eingabe.autocomplete = "off";
  eingabe.spellcheck = false;
  eingabe.placeholder = "???";
  eingabe.value = kuerzelSaeubern(lade("global", "initialen", ""));
  const knopf = document.createElement("button");
  knopf.type = "submit";
  knopf.textContent = "Ändern";
  const meldung = document.createElement("span");
  meldung.className = "topliste-name-meldung";
  meldung.setAttribute("aria-live", "polite");
  form.append(label, eingabe, knopf, meldung);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const neu = kuerzelSaeubern(eingabe.value);
    if (!neu) {
      meldung.textContent = "Bitte 1–3 Zeichen (A–Z, 0–9).";
      return;
    }
    if (neu === kuerzelSaeubern(lade("global", "initialen", "")) && form.dataset.fertig === neu)
      return;
    knopf.disabled = true;
    meldung.textContent = "…";
    const n = await ueberallUmbenennen(neu);
    knopf.disabled = false;
    eingabe.value = neu;
    form.dataset.fertig = neu;
    // Andere Namensfelder auf der Seite mitziehen
    for (const f of document.querySelectorAll(".topliste-name .initialen"))
      if (f !== eingabe) f.value = neu;
    meldung.textContent =
      n === null
        ? "Gemerkt – weltweit klappt es gerade nicht."
        : `Gespeichert${n ? ` (${n} Einträge)` : ""}.`;
  });
  return form;
}

/**
 * Zeigt den Game-Over-Dialog eines Spiels.
 *
 * optionen = {
 *   spiel:       "snake"            // Schlüssel für den Speicher
 *   titel:       "GAME OVER"        // Überschrift
 *   punkte:      42                 // erreichte Punktzahl
 *   punkteText:  "42 Punkte"        // optional: hübsche Anzeige
 *   richtung:    "hoch" | "runter"  // mehr oder weniger ist besser?
 *   format:      (p) => `${p} …`    // optional: Punkteformat der Topliste
 *   neustart:    () => { … }        // wird bei "Nochmal" aufgerufen
 * }
 *
 * ZUM EINTRAGEN: Reicht das Ergebnis für die Top 3, wird es STILL mit
 * den zuletzt benutzten Initialen eingetragen und in der Liste nur
 * dezent markiert. Darunter steht eine kleine, unaufdringliche Zeile,
 * in der man die Initialen ändern KANN – keine Aufforderung, kein
 * eigener Knopf, kein "Trag dich jetzt ein!". Wer den Dialog einfach
 * wegklickt, hat trotzdem seinen Eintrag.
 */
export function gameOverDialog(optionen) {
  const {
    spiel,
    titel = "GAME OVER",
    punkte,
    punkteText,
    richtung = "hoch",
    format,
    neustart,
  } = optionen;

  // Gibt es den Dialog schon (vom letzten Mal)? Dann aufräumen.
  document.getElementById("spiel-dialog")?.remove();

  const dialog = document.createElement("dialog");
  dialog.className = "spiel-dialog";
  dialog.id = "spiel-dialog";

  // Still eintragen (0 Punkte zählen nie als Rekord, das prüft
  // stillEintragen selbst). platz ist 1–3 oder null.
  // Fortschritt zuerst (vergleicht mit dem alten Bestwert), dann eintragen
  let fsErgebnis = null;
  try {
    fsErgebnis = FS.runde(spiel, { punkte, richtung });
  } catch {
    /* Fortschritt ist Zugabe */
  }
  const platz = stillEintragen(spiel, punkte, richtung);

  // Grundgerüst des Dialogs. Die dynamischen Werte (Punkte) werden
  // unten per textContent gesetzt – nie ungeprüft in HTML mischen.
  dialog.innerHTML = `
    <h2></h2>
    <p class="gross"></p>
    <p class="spruch" hidden></p>
    <div class="fs-halter"></div>
    <div class="topliste-halter"></div>
    ${
      platz
        ? `
      <p class="initialen-zeile">Eingetragen als
        <input class="initialen klein" maxlength="3" autocomplete="off"
               spellcheck="false" placeholder="???" aria-label="Initialen ändern (3 Zeichen)">
      </p>
    `
        : ""
    }
    <div class="aktionen">
      <button class="knopf primaer" data-rolle="nochmal">Nochmal</button>
      <a class="knopf" href="../index.html">Zur Übersicht</a>
    </div>`;

  dialog.querySelector("h2").textContent = titel;
  dialog.querySelector(".gross").textContent = punkteText ?? String(punkte);
  // Ein kleiner Trost-Spruch (nur Arcade-Spiele, siehe sprueche.js)
  const spruch = spruchFuer(spiel);
  if (spruch) {
    const zeile = dialog.querySelector(".spruch");
    zeile.textContent = spruch;
    zeile.hidden = false;
  }

  try {
    dialog.querySelector(".fs-halter").append(FS.dialogKasten(fsErgebnis));
  } catch {
    /* egal */
  }
  const halter = dialog.querySelector(".topliste-halter");
  if (platz) halter.dataset.ohneName = "1";
  else delete halter.dataset.ohneName;
  toplisteAnzeigen(halter, spiel, format, platz);

  // --- Dezente Initialen-Änderung: wirkt direkt beim Tippen ----
  if (platz) {
    const eingabe = dialog.querySelector(".initialen");
    // "???" nur als Platzhalter: Wer noch keine Initialen hat, tippt sofort los
    eingabe.value = String(lade("global", "initialen", "")).slice(0, 3);
    let melder = null;
    eingabe.addEventListener("input", () => {
      const initialen = eingabe.value.trim().toUpperCase().slice(0, 3);
      if (!initialen) return;
      speichere("global", "initialen", initialen);
      initialenAendern(spiel, platz, initialen);
      toplisteAnzeigen(halter, spiel, format, platz);
      // Server erst nach kurzer Tipp-Pause informieren (eine Anfrage statt drei)
      clearTimeout(melder);
      melder = setTimeout(() => ueberallUmbenennen(initialen, { lokal: false }), 800);
    });
  }

  // --- "Nochmal" startet das Spiel neu ------------------------
  dialog.querySelector('[data-rolle="nochmal"]').addEventListener("click", () => {
    dialog.close();
    dialog.remove();
    neustart?.();
  });

  // Esc (= "cancel"-Event) soll den Dialog auch sauber entfernen
  dialog.addEventListener("cancel", () => dialog.remove());

  document.body.append(dialog);
  dialog.showModal();
  // Fokus bewusst auf "Nochmal", NICHT auf die Initialen-Eingabe –
  // der Eintrag ist ja schon passiert, niemand MUSS hier etwas tippen.
  dialog.querySelector('[data-rolle="nochmal"]')?.focus();
  return dialog;
}
