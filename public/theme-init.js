// Apply the saved theme before first paint to avoid a flash. Kept as a file (not inline)
// so the Content-Security-Policy can forbid inline scripts.
try {
  var t = localStorage.getItem("kaasu.theme") || "system";
  var dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  if (dark) document.documentElement.classList.add("dark");
} catch (e) {
  /* storage blocked: fall back to the system theme via CSS */
}
