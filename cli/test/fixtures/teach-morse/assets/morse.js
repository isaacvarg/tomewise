window.Morse = {
  codes: { K: "-.-", M: "--", R: ".-.", S: "...", U: "..-" },
  load(key, fallback) {
    try { const v = localStorage.getItem("morse:" + key); return v == null ? fallback : JSON.parse(v); }
    catch (e) { return fallback; }
  },
  save(key, value) {
    try { localStorage.setItem("morse:" + key, JSON.stringify(value)); } catch (e) {}
  },
};
