(function () {
  const el = document.getElementById("cards");
  const cards = el.dataset.cards.split(",").map((pair) => pair.split(":"));
  const seen = JSON.parse(localStorage.getItem("kana:seen") || "{}");
  let at = 0;
  function show() {
    const [front, back] = cards[at];
    el.innerHTML = '<div class="card">' + front + '</div><button id="flip">Flip</button>';
    document.getElementById("flip").onclick = () => {
      el.querySelector(".card").textContent = back;
      seen[front] = (seen[front] || 0) + 1;
      localStorage.setItem("kana:seen", JSON.stringify(seen));
      at = (at + 1) % cards.length;
      setTimeout(show, 1000);
    };
  }
  show();
})();
