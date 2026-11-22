(function () {
  const el = document.getElementById("drill");
  const letters = el.dataset.letters.split("");
  const history = Morse.load("listen-history", []);
  el.textContent = "Listen and type: " + letters.join(", ") + " (" + history.length + " tries so far)";
})();
