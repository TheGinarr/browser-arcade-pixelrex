/* ============================================================
   levelwahl.js · Level-Auswahl mit Freischalten
   ------------------------------------------------------------
   Die Arcade-Spiele haben feste, handgebaute Level. Wer ein Level
   einmal erreicht hat, kann es später direkt anwählen. Gespeichert
   wird nur EINE Zahl pro Spiel: das höchste erreichte Level
   (ba:<spiel>:level-frei). Nach dem letzten festen Level geht es
   endlos weiter, die Auswahl zeigt aber nur die festen.

   Benutzung in einem Spiel:
     import { levelWahl } from "./assets/levelwahl.js";
     const wahl = levelWahl({
       spiel: "mauerbrecher",
       namen: ["Klassik", "Pyramide", …],
       nach: document.querySelector(".steuerung"),   // wird danach eingefügt
       beiWahl: (nummer) => neuesSpiel(nummer),
       gesperrt: () => phase === "laeuft",           // während des Spiels nicht wechseln
     });
     wahl.erreicht(level);   // beim Levelwechsel aufrufen
     wahl.aktiv(level);      // Markierung setzen (z. B. nach neuesSpiel)
   ============================================================ */

import { lade, speichere } from "./storage.js";

const SCHLUESSEL = "level-frei";

/** Höchstes freigeschaltetes Level (mindestens 1). */
export function freiBis(spiel) {
  const wert = Number(lade(spiel, SCHLUESSEL, 1));
  return Number.isFinite(wert) && wert >= 1 ? Math.floor(wert) : 1;
}

export function levelWahl({ spiel, namen, nach, beiWahl, gesperrt = () => false, titel = "Level wählen" }) {
  const anzahl = namen.length;
  const box = document.createElement("section");
  box.className = "level-wahl";
  box.setAttribute("aria-labelledby", `lw-titel-${spiel}`);
  box.innerHTML = `
    <h2 id="lw-titel-${spiel}">${titel}</h2>
    <div class="level-liste" role="group"></div>
    <p class="level-info" aria-live="polite"></p>`;
  const liste = box.querySelector(".level-liste");
  const info = box.querySelector(".level-info");
  nach.after(box);

  let gewaehlt = 1;
  const knoepfe = namen.map((name, i) => {
    const nummer = i + 1;
    const k = document.createElement("button");
    k.type = "button";
    k.className = "level-knopf";
    k.dataset.level = String(nummer);
    k.innerHTML = `<span class="lk-nr">${nummer}</span><span class="lk-name"></span>`;
    k.querySelector(".lk-name").textContent = name;
    k.addEventListener("click", () => {
      if (k.disabled) return;
      if (gesperrt()) {
        info.textContent = "Erst pausieren oder die Runde beenden, dann kannst du das Level wechseln.";
        return;
      }
      aktiv(nummer);
      info.textContent = `Level ${nummer} „${name}“ ist bereit.`;
      beiWahl(nummer);
      k.blur();                // sonst würde die Leertaste den Knopf erneut drücken
    });
    liste.append(k);
    return k;
  });

  function zeichnen() {
    const frei = freiBis(spiel);
    knoepfe.forEach((k, i) => {
      const nummer = i + 1;
      const offen = nummer <= frei;
      k.disabled = !offen;
      k.classList.toggle("gesperrt", !offen);
      k.setAttribute("aria-label", offen ? `Level ${nummer}: ${namen[i]}` : `Level ${nummer}: noch gesperrt`);
      k.setAttribute("aria-pressed", String(nummer === gewaehlt));
    });
    if (!info.textContent) {
      info.textContent = frei >= anzahl
        ? `Alle ${anzahl} Level freigeschaltet. Danach geht es endlos weiter.`
        : `${frei} von ${anzahl} Leveln freigeschaltet. Erreiche ein Level einmal, um es hier direkt zu starten.`;
    }
  }

  /** Markiert ein Level als gewählt (Level über der Liste zählen als letztes). */
  function aktiv(nummer) {
    gewaehlt = Math.min(nummer, anzahl);
    zeichnen();
  }

  /** Meldet ein erreichtes Level. Schaltet es (und alle davor) frei. */
  function erreicht(nummer) {
    if (nummer > freiBis(spiel)) {
      speichere(spiel, SCHLUESSEL, Math.min(nummer, anzahl));
      if (nummer <= anzahl) info.textContent = `Neu freigeschaltet: Level ${nummer} „${namen[nummer - 1]}“.`;
    }
    zeichnen();
  }

  /** Nach einem Reset des Spielstands neu einlesen. */
  function neuLaden() {
    info.textContent = "";
    zeichnen();
  }

  zeichnen();
  return { aktiv, erreicht, neuLaden, frei: () => freiBis(spiel) };
}
