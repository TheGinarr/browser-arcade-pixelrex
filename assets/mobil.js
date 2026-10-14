/* ============================================================
   mobil.js · Handy-Tauglichkeit für die Arcade-Spiele
   ------------------------------------------------------------
   Ein Baustein, den jede Arcade-Seite mit EINEM Aufruf einbindet:

     import { spielSeite, istTouch } from "../assets/mobil.js";
     const mobil = spielSeite({
       phase: () => phase,                       // aktuelle Spielphase
       gamepad: { links: "kreuz", rechts: [] },  // Tasten am Handy
     });

   Was der Baustein erledigt (ohne dass das Spiel davon weiß):
   1. EINPASSEN: Das Canvas wird so groß, dass HUD, Spielfeld und
      Gamepad zusammen in den sichtbaren Bereich passen. Rechnet mit
      visualViewport (berücksichtigt die Browserleisten am Handy).
   2. GAMEPAD: Bildschirmtasten für Touch-Geräte. Sie schicken
      künstliche Tastatur-Ereignisse (KeyboardEvent) an das Dokument.
      Das Spiel hört ohnehin auf die Tastatur und merkt keinen
      Unterschied. Mehrere Finger gleichzeitig gehen (Pointer Events
      mit eigener Zeiger-Liste), beim Steuerkreuz darf der Daumen von
      Taste zu Taste gleiten.
   3. SCROLL-SPERRE: Während das Spiel läuft, verschiebt sich am
      Handy nichts mehr (touchmove wird verworfen, kein Pull-to-
      Refresh, kein Doppeltipp-Zoom). Beim Start rollt die Seite das
      Spielfeld automatisch ins Bild.
   4. SPIELMODUS: Ein Knopf blendet alles außer HUD, Feld und Gamepad
      aus und schaltet (wo der Browser es kann) auf Vollbild. Auf dem
      iPhone gibt es keine Vollbild-Schnittstelle für Webseiten, dort
      reicht das Ausblenden.
   5. ANSAGEN: Eine unsichtbare Live-Region (role="status") meldet
      Screenreadern Leben, Level, Pause. Leben/Level/Runde/Welle liest
      der Baustein selbst aus dem HUD (MutationObserver).
   6. TASTEN NUR BEIM SPIELEN: Ist das Spielfeld nicht im Bild und
      läuft kein Spiel, scrollen Pfeiltasten und Leertaste wieder
      ganz normal die Seite, statt ein Spiel zu starten.
   7. CRT-FILTER: Scanlines und leichtes Glühen über dem Feld, per
      Knopf an/aus, die Wahl wird gespeichert.
   ============================================================ */

import { lade, speichere } from "./storage.js";

// In Node (Tests der reinen Logik) gibt es kein document: dann bleibt alles still.
const imBrowser = typeof document !== "undefined";
const html = imBrowser ? document.documentElement : null;

/* ---------- Touch erkennen ----------------------------------
   "pointer: coarse" = Hauptzeiger ist ein Finger. Zusätzlich
   schaltet jede echte Berührung bzw. Mausbedienung um (Laptops mit
   Touchscreen). Die Klasse .touch am <html> steuert per CSS, ob
   Gamepad und Touch-Texte erscheinen. */
if (imBrowser) {
  const grob = window.matchMedia("(pointer: coarse)");
  if (grob.matches) html.classList.add("touch");
  grob.addEventListener?.("change", () => html.classList.toggle("touch", grob.matches));
  window.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType === "touch" || e.pointerType === "pen") html.classList.add("touch");
      else if (e.pointerType === "mouse" && !grob.matches) html.classList.remove("touch");
    },
    true,
  );
}

/** true, wenn gerade mit dem Finger gespielt wird (für Texte im Canvas). */
export function istTouch() {
  return Boolean(html?.classList.contains("touch"));
}

/** Wählt den passenden Text: Tastatur-Variante oder Touch-Variante. */
export function text(tastatur, touch) {
  return istTouch() ? touch : tastatur;
}

/* ---------- Vorlagen für Gamepad-Tasten ---------------------
   key = genau der Wert, den eine echte Tastatur in KeyboardEvent.key
   liefert. Die Spiele vergleichen key.toLowerCase(), daher passt
   "ArrowUp" zu ihrem "arrowup". */
export const TASTE = {
  hoch: { key: "ArrowUp", zeichen: "▲", name: "Hoch" },
  runter: { key: "ArrowDown", zeichen: "▼", name: "Runter" },
  links: { key: "ArrowLeft", zeichen: "◀", name: "Links" },
  rechts: { key: "ArrowRight", zeichen: "▶", name: "Rechts" },
  leer: { key: " ", zeichen: "●", name: "Aktion" },
  pause: { key: "p", zeichen: "❚❚", name: "Pause" },
};

/* ---------- Künstliche Tastendrücke -------------------------- */
function tasteSenden(typ, key) {
  const ereignis = new KeyboardEvent(typ, { key, bubbles: true, cancelable: true });
  ereignis.vomGamepad = true; // damit der Tasten-Wächter (Punkt 6) es durchlässt
  document.dispatchEvent(ereignis);
}

/* ---------- Live-Region für Screenreader -------------------- */
let ansageBox = null;
// Die Live-Region muss schon VOR der ersten Meldung im Dokument stehen,
// sonst verpassen manche Screenreader die erste Ansage.
function ansageBoxAnlegen() {
  if (ansageBox) return;
  ansageBox = document.createElement("div");
  ansageBox.className = "nur-sr";
  ansageBox.setAttribute("role", "status");
  ansageBox.setAttribute("aria-live", "polite");
  document.body.append(ansageBox);
}
export function ansage(nachricht) {
  ansageBoxAnlegen();
  // Erst leeren, dann (kurz versetzt) setzen: so wird auch dieselbe
  // Meldung zweimal hintereinander erneut vorgelesen.
  ansageBox.textContent = "";
  setTimeout(() => {
    ansageBox.textContent = nachricht;
  }, 60);
}

/* ============================================================
   spielSeite(): bindet alles an die aktuelle Arcade-Seite
   ------------------------------------------------------------
   optionen = {
     phase:   () => "bereit" | "laeuft" | "pause" | "vorbei" | …
     gamepad: {
       links:  "kreuz" | [tastenDef, …] | null,
       rechts: "kreuz" | [tastenDef, …] | null,
     }
       tastenDef = { key, zeichen, name, gross?, breit? }
     pauseKnopf: true          // Pause-Taste in der Leiste (Standard: true)
   }
   Rückgabe: { ansage, einpassen }
   ============================================================ */
export function spielSeite(optionen = {}) {
  const phase = optionen.phase ?? (() => "laeuft");
  const buehne = document.querySelector(".buehne");
  const leinwand = buehne?.querySelector("canvas");
  const hud = document.querySelector(".hud");
  const kopf = document.querySelector(".kopf");
  if (!buehne) return { ansage, einpassen() {} };

  buehne.classList.add("arcade-buehne");
  ansageBoxAnlegen();

  /* ---------- Steuerbereich: Gamepad + Werkzeugleiste -------- */
  const steuer = document.createElement("div");
  steuer.className = "steuerbereich";

  const pad = document.createElement("div");
  pad.className = "gamepad";
  pad.setAttribute("aria-label", "Bildschirm-Steuerung");
  pad.setAttribute("role", "group");
  const gp = optionen.gamepad ?? {};
  for (const seite of ["links", "rechts"]) {
    const gruppe = document.createElement("div");
    gruppe.className = `gp-gruppe gp-${seite}`;
    const def = gp[seite];
    if (def === "kreuz") {
      gruppe.classList.add("gp-kreuz");
      for (const [richtung, t] of [
        ["hoch", TASTE.hoch],
        ["links", TASTE.links],
        ["rechts", TASTE.rechts],
        ["runter", TASTE.runter],
      ]) {
        gruppe.append(tastenKnopf(t, `gp-${richtung}`, true));
      }
    } else if (Array.isArray(def)) {
      gruppe.classList.add("gp-reihe");
      for (const t of def) gruppe.append(tastenKnopf(t, t.gross ? "gp-gross" : "", false));
    }
    pad.append(gruppe);
  }
  // Nur eine Seite belegt (z. B. nur Steuerkreuz)? Dann mittig, gut für eine Hand.
  if (!gp.links !== !gp.rechts) pad.classList.add("gp-mitte");

  function tastenKnopf(t, klasse, gleiten) {
    const k = document.createElement("button");
    k.type = "button";
    k.className = `gp-taste ${klasse}`.trim();
    k.dataset.taste = t.key;
    if (gleiten) k.dataset.gleiten = "";
    if (t.breit) k.classList.add("gp-breit");
    k.setAttribute("aria-label", t.name);
    const zeichen = `<span aria-hidden="true">${t.zeichen}</span>`;
    const beschriftung = t.beschriftung
      ? `<small aria-hidden="true">${t.beschriftung}</small>`
      : "";
    k.innerHTML = zeichen + beschriftung;
    return k;
  }

  const leiste = document.createElement("div");
  leiste.className = "werkzeugleiste";
  const knoepfe = [];
  if (optionen.pauseKnopf !== false) {
    knoepfe.push(`
      <button type="button" class="wz-knopf" data-aktion="pause" aria-label="Pause oder weiter">
        <span aria-hidden="true">❚❚</span> Pause
      </button>`);
  }
  knoepfe.push(`
    <button type="button" class="wz-knopf" data-aktion="spielmodus" aria-pressed="false">
      <span aria-hidden="true">⛶</span> <span class="wz-text">Spielmodus</span>
    </button>`);
  knoepfe.push(`
    <button
      type="button"
      class="wz-knopf"
      data-aktion="crt"
      aria-pressed="false"
      aria-label="Röhren-Look (Scanlines)"
    >
      <span aria-hidden="true">▤</span> Röhre
    </button>`);
  leiste.innerHTML = knoepfe.join("");

  steuer.append(pad, leiste);
  buehne.after(steuer);

  /* ---------- Gamepad: Zeiger verwalten ----------------------
     Map: pointerId → gedrückter Knopf. Pro Taste zählen wir, wie
     viele Finger sie halten, keyup kommt erst beim letzten. */
  const aktiv = new Map();
  const zaehler = new Map();

  function druecken(id, knopf) {
    aktiv.set(id, knopf);
    knopf.classList.add("gedrueckt");
    const key = knopf.dataset.taste;
    const n = (zaehler.get(key) ?? 0) + 1;
    zaehler.set(key, n);
    if (n === 1) {
      tasteSenden("keydown", key);
      if (navigator.vibrate && !lade("global", "vibration-aus", false)) navigator.vibrate(8);
    }
  }
  function loslassen(id) {
    const knopf = aktiv.get(id);
    if (!knopf) return;
    aktiv.delete(id);
    if (![...aktiv.values()].includes(knopf)) knopf.classList.remove("gedrueckt");
    const key = knopf.dataset.taste;
    const n = Math.max(0, (zaehler.get(key) ?? 1) - 1);
    zaehler.set(key, n);
    if (n === 0) tasteSenden("keyup", key);
  }

  pad.addEventListener("pointerdown", (e) => {
    const knopf = e.target.closest(".gp-taste");
    if (!knopf) return;
    e.preventDefault(); // kein Fokus-Sprung, kein Doppeltipp-Zoom
    try {
      pad.setPointerCapture(e.pointerId);
    } catch {
      /* z. B. künstliche Zeiger in Tests */
    }
    druecken(e.pointerId, knopf);
  });
  pad.addEventListener("pointermove", (e) => {
    const alt = aktiv.get(e.pointerId);
    if (!alt || !("gleiten" in alt.dataset)) return;
    const unter = document.elementFromPoint(e.clientX, e.clientY)?.closest(".gp-taste");
    if (
      unter &&
      unter !== alt &&
      "gleiten" in unter.dataset &&
      unter.parentElement === alt.parentElement
    ) {
      loslassen(e.pointerId);
      druecken(e.pointerId, unter);
    }
  });
  for (const art of ["pointerup", "pointercancel", "lostpointercapture"]) {
    pad.addEventListener(art, (e) => loslassen(e.pointerId));
  }
  // Tastatur-Bedienung der Knöpfe selbst (Tab + Enter): kurzer Druck
  pad.addEventListener("click", (e) => {
    const knopf = e.target.closest(".gp-taste");
    if (!knopf || e.detail !== 0) return; // detail 0 = per Tastatur ausgelöst
    tasteSenden("keydown", knopf.dataset.taste);
    tasteSenden("keyup", knopf.dataset.taste);
  });
  pad.addEventListener("contextmenu", (e) => e.preventDefault());

  /* ---------- Werkzeugleiste --------------------------------- */
  const crtKnopf = leiste.querySelector('[data-aktion="crt"]');
  const modusKnopf = leiste.querySelector('[data-aktion="spielmodus"]');

  function crtSetzen(an) {
    buehne.classList.toggle("crt", an);
    crtKnopf.setAttribute("aria-pressed", String(an));
  }
  crtSetzen(Boolean(lade("global", "crt", false)));

  leiste.addEventListener("click", (e) => {
    const knopf = e.target.closest("[data-aktion]");
    if (!knopf) return;
    const aktion = knopf.dataset.aktion;
    if (aktion === "pause") {
      tasteSenden("keydown", "p");
      tasteSenden("keyup", "p");
    } else if (aktion === "crt") {
      const an = !buehne.classList.contains("crt");
      crtSetzen(an);
      speichere("global", "crt", an);
    } else if (aktion === "spielmodus") {
      spielmodus(!document.body.classList.contains("spielmodus"));
    }
    knopf.blur(); // sonst würde die Leertaste den Knopf erneut drücken
  });

  /* ---------- Spielmodus (Vollbild) -------------------------- */
  let echtesVollbild = false;
  async function spielmodus(an) {
    document.body.classList.toggle("spielmodus", an);
    modusKnopf.setAttribute("aria-pressed", String(an));
    modusKnopf.querySelector(".wz-text").textContent = an ? "Beenden" : "Spielmodus";
    if (an) {
      try {
        if (document.fullscreenEnabled && !document.fullscreenElement) {
          await html.requestFullscreen({ navigationUI: "hide" });
          echtesVollbild = true;
        }
      } catch {
        echtesVollbild = false;
      }
      window.scrollTo(0, 0);
    } else if (document.fullscreenElement) {
      echtesVollbild = false;
      try {
        await document.exitFullscreen();
      } catch {
        /* egal */
      }
    }
    requestAnimationFrame(einpassen);
  }
  // Vollbild per Esc/Zurück-Geste verlassen → Spielmodus ebenfalls beenden
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && echtesVollbild) {
      echtesVollbild = false;
      spielmodus(false);
    }
  });

  /* ---------- Einpassen -------------------------------------- */
  function einpassen() {
    if (!leinwand) return;
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const imModus = document.body.classList.contains("spielmodus");
    const kopfH = imModus || !kopf ? 0 : kopf.offsetHeight;
    const hudH = hud ? hud.offsetHeight + 16 : 0;
    // Am Handy darf die Werkzeugleiste unter den Bildrand rutschen, das Gamepad nicht.
    // (im Spielmodus muss sie sichtbar bleiben: Dort sitzt „Beenden“).
    const steuerH = (istTouch() && !imModus ? pad.offsetHeight : steuer.offsetHeight) + 12;
    const stil = getComputedStyle(buehne);
    const innenV = parseFloat(stil.paddingTop) + parseFloat(stil.paddingBottom) + 2;
    const innenH = parseFloat(stil.paddingLeft) + parseFloat(stil.paddingRight);
    const hoehe = Math.max(180, vh - kopfH - hudH - steuerH - innenV - 12);
    const verhaeltnis = leinwand.width / leinwand.height;
    const maxBreite = buehne.clientWidth - innenH;
    const cssMax = parseFloat(leinwand.style.maxWidth) || Infinity;
    const breite = Math.floor(Math.min(maxBreite, cssMax, hoehe * verhaeltnis));
    leinwand.style.width = `${breite}px`;
    // Lage des Canvas in der Bühne für den Röhren-Look (CSS ::after)
    requestAnimationFrame(() => {
      buehne.style.setProperty("--cx", `${leinwand.offsetLeft}px`);
      buehne.style.setProperty("--cy", `${leinwand.offsetTop}px`);
      buehne.style.setProperty("--cw", `${leinwand.offsetWidth}px`);
      buehne.style.setProperty("--ch", `${leinwand.offsetHeight}px`);
    });
  }
  window.addEventListener("resize", einpassen);
  window.visualViewport?.addEventListener("resize", einpassen);
  const beobachter = new ResizeObserver(() => requestAnimationFrame(einpassen));
  if (hud) beobachter.observe(hud);
  beobachter.observe(steuer);
  beobachter.observe(buehne.parentElement);
  requestAnimationFrame(einpassen);

  /* ---------- Feld ins Bild rollen --------------------------- */
  function insBild() {
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const imModus = document.body.classList.contains("spielmodus");
    const oben = (imModus || !kopf ? 0 : kopf.offsetHeight) + 6;
    const anfang = (hud ?? buehne).getBoundingClientRect().top;
    const ende = (istTouch() ? pad : steuer).getBoundingClientRect().bottom;
    if (anfang < oben || ende > vh + 2) {
      const ziel = window.scrollY + anfang - oben;
      const ruhig = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: ziel, behavior: ruhig ? "auto" : "smooth" });
    }
  }

  /* ---------- Phase beobachten ------------------------------- */
  let letzte = phase();
  function beobachten() {
    const jetzt = phase();
    if (jetzt !== letzte) {
      const laeuft = jetzt === "laeuft";
      document.body.classList.toggle("spiel-laeuft", laeuft);
      if (laeuft && letzte !== "pause") insBild();
      if (jetzt === "pause") ansage("Pause");
      else if (laeuft && letzte === "pause") ansage("Weiter");
      letzte = jetzt;
    }
    requestAnimationFrame(beobachten);
  }
  requestAnimationFrame(beobachten);

  /* ---------- Scroll-Sperre am Handy -------------------------
     Solange gespielt wird, verwerfen wir jede Wisch-Bewegung über
     der Seite. Nur ein touchmove-Listener mit passive:false darf
     preventDefault() aufrufen. */
  document.addEventListener(
    "touchmove",
    (e) => {
      if (
        document.body.classList.contains("spiel-laeuft") ||
        e.target.closest?.(".arcade-buehne, .steuerbereich")
      ) {
        e.preventDefault();
      }
    },
    { passive: false },
  );

  /* ---------- Tasten-Wächter (Punkt 6) -----------------------
     Läuft im Capture der window-Ebene, also VOR den Listenern der
     Spiele (die am document hängen). */
  const SPIELTASTEN = new Set([
    " ",
    "enter",
    "arrowup",
    "arrowdown",
    "arrowleft",
    "arrowright",
    "w",
    "a",
    "s",
    "d",
  ]);
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.vomGamepad || e.ctrlKey || e.metaKey || e.altKey) return;
      const p = phase();
      if (p === "laeuft" || p === "pause") return;
      if (!SPIELTASTEN.has(e.key.toLowerCase())) return;
      if (document.getElementById("spiel-dialog")) return;
      const r = buehne.getBoundingClientRect();
      const vh = window.innerHeight;
      const kopfH = kopf?.offsetHeight ?? 0;
      const sichtbar = r.bottom > kopfH + 60 && r.top < vh - 60;
      if (!sichtbar) e.stopImmediatePropagation(); // Seite scrollt normal weiter
    },
    true,
  );

  /* ---------- HUD-Ansagen ------------------------------------ */
  const ANSAGEN = ["leben", "level", "runde", "welle"];
  hud?.querySelectorAll(".hud-feld").forEach((feld) => {
    const label = feld.querySelector(".label")?.textContent.trim() ?? "";
    const wert = feld.querySelector(".wert");
    if (!wert || !ANSAGEN.includes(label.toLowerCase())) return;
    let alt = wert.textContent;
    new MutationObserver(() => {
      if (wert.textContent === alt) return;
      alt = wert.textContent;
      if (phase() === "laeuft" || phase() === "pause") ansage(`${label}: ${alt}`);
    }).observe(wert, { childList: true, characterData: true, subtree: true });
  });

  return { ansage, einpassen, insBild };
}
