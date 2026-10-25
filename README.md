# PIXELREX

Endlos-Läufer im Browser: Spring mit dem neon-pinken Pixelrex über Kristalle, dück dich unter Drohnen durch und lauf so weit wie möglich. Mit Tastatur oder Touch spielbar.

Teil der Sammlung Browser-Arcade, hier als eigenständiges Spiel: nur HTML, CSS und
Vanilla-JavaScript, keine Abhängigkeiten, kein Build-Schritt, keine Cookies, kein Tracking.
Spielstände und Highscores liegen im localStorage des Browsers.

## Starten

Wegen der ES-Module braucht es einen (beliebigen) Webserver:

```bash
python3 -m http.server 8000
# dann http://localhost:8000/ öffnen
```

Oder den Ordner auf einen statischen Hoster laden (GitHub Pages, Netlify, eigener Webserver).

## Aufbau

- `index.html` – Spielseite mit Anleitung und Lernbox „Wie funktioniert der Code?“
- `game.js`, `logik.js` – Spiellogik, ausführlich auf Deutsch kommentiert
- `assets/` – gemeinsame Bausteine (Design, Speicher, Dialoge, Handy-Steuerung) und lokale Schriften
- `impressum.html`, `datenschutz.html` – **Vorlagen** mit Platzhaltern in eckigen Klammern, vor dem Veröffentlichen ausfüllen (keine Rechtsberatung)

## Online-Funktionen (optional)

- **Online-Topliste** (`assets/bestenliste.js`): sendet den eigenen Bestwert an `/api/…` auf derselben Domain.

Der Server dafür ist nicht enthalten. Ohne ihn schlagen nur diese Aufrufe fehl,
das Spiel selbst läuft normal. Wer die Funktionen betreibt, beschreibt sie in
`datenschutz.html` (Vorlage enthält die Abschnitte 3a und 3b).

## Code-Stil

Der Code ist mit [Prettier](https://prettier.io) formatiert (Einstellungen in `.prettierrc.json`,
Editor-Grundlagen in `.editorconfig`): 2 Leerzeichen Einrückung, eine CSS-Regel pro Zeile,
höchstens 100 Zeichen pro Zeile. Vor einem Commit einfach `npx prettier --write .` ausführen.

## Lizenz

Code: MIT (`LICENSE`). Schriften: SIL Open Font License 1.1 (Press Start 2P und IBM Plex,
`assets/fonts/OFL-LIZENZ.txt`).
Alle Grafiken entstehen im Code, ohne fremde Bilddateien. Code und Grafiken entstanden mit
Unterstützung von KI.
