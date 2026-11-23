(function () {
  const el = document.getElementById("strokes");
  const strokes = el.dataset.strokes.split("|");
  const shuffled = strokes.slice().sort(() => Math.random() - 0.5);
  let next = 0;
  el.innerHTML = "<p>Tap the strokes of " + el.dataset.kana + " in order.</p>";
  for (const stroke of shuffled) {
    const button = document.createElement("button");
    button.textContent = stroke;
    button.onclick = () => {
      if (stroke === strokes[next]) { next++; button.disabled = true; }
      else { button.style.color = "red"; }
      if (next === strokes.length) {
        const done = JSON.parse(localStorage.getItem("kana:strokes") || "[]");
        done.push(el.dataset.kana);
        localStorage.setItem("kana:strokes", JSON.stringify(done));
      }
    };
    el.appendChild(button);
  }
})();
