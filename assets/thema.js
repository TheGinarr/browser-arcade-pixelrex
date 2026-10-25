// Hell/Dunkel-Umschalter: ohne Wahl folgt die Seite der Systemeinstellung,
// nach Klick gilt die eigene Wahl (lokal ba:thema). Lädt früh im <head>.
(function () {
  var S = "ba:thema",
    h = document.documentElement,
    mq = matchMedia("(prefers-color-scheme: light)");
  function lesen() {
    try {
      return localStorage.getItem(S);
    } catch (e) {
      return null;
    }
  }
  function aktuell() {
    return h.dataset.thema || (mq.matches ? "hell" : "dunkel");
  }
  function setzen(t) {
    if (t) h.dataset.thema = t;
    else delete h.dataset.thema;
    var farbe = aktuell() === "hell" ? "#f2f3f9" : "#07070f";
    document.querySelectorAll('meta[name="theme-color"]').forEach(function (m) {
      if (t) m.removeAttribute("media");
      m.content = farbe;
    });
    var k = document.querySelector(".thema-knopf");
    if (k) {
      var hell = aktuell() === "hell";
      k.textContent = hell ? "☾" : "☀";
      k.setAttribute(
        "aria-label",
        hell ? "Dunkles Design einschalten" : "Helles Design einschalten",
      );
      k.title = k.getAttribute("aria-label");
    }
  }
  var w = lesen();
  if (w === "hell" || w === "dunkel") h.dataset.thema = w;
  document.addEventListener("DOMContentLoaded", function () {
    var nav = document.querySelector(".nav-links") || document.querySelector(".nav");
    if (!nav) return;
    var k = document.createElement("button");
    k.type = "button";
    k.className = "thema-knopf";
    k.addEventListener("click", function () {
      var neu = aktuell() === "hell" ? "dunkel" : "hell";
      try {
        localStorage.setItem(S, neu);
      } catch (e) {}
      setzen(neu);
    });
    nav.appendChild(k);
    setzen(h.dataset.thema);
  });
  mq.addEventListener("change", function () {
    if (!h.dataset.thema) setzen();
  });
})();
