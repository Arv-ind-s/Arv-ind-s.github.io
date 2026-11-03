// Content stays readable without JavaScript; controls enhance the static examples.
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const runningAnimations = new Set();
function animateOnce(element, frames, options) {
  if (reducedMotion.matches || !element?.animate) return;
  const animation = element.animate(frames, options);
  runningAnimations.add(animation);
  animation.finished
    .catch(() => {})
    .finally(() => runningAnimations.delete(animation));
}
reducedMotion.addEventListener("change", () => {
  if (reducedMotion.matches)
    runningAnimations.forEach((animation) => animation.cancel());
});
// Every artifact changes the example itself, not only its headline.
document.querySelectorAll(".sample-explorer").forEach((explorer) => {
  const controls = explorer.querySelector(".sample-controls");
  const buttons = [...controls.querySelectorAll("[data-sample]")];
  const panels = [...explorer.querySelectorAll("[data-sample-panel]")];
  controls.hidden = false;
  function select(key, animate = true) {
    buttons.forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.sample === key),
      ),
    );
    panels.forEach((panel) => {
      panel.hidden = panel.dataset.samplePanel !== key;
      if (!panel.hidden && animate)
        animateOnce(
          panel,
          [
            { opacity: 0.9, transform: "translateY(5px)" },
            { opacity: 1, transform: "translateY(0)" },
          ],
          { duration: 260, easing: "ease-out" },
        );
    });
  }
  buttons.forEach((button) =>
    button.addEventListener("click", () => select(button.dataset.sample)),
  );
  select("spec", false);
});
const approach = document.querySelector(".approach-study");
if (approach) {
  const scene = approach.querySelector(".system-scene");
  const controls = approach.querySelector(".approach-controls");
  const panels = [...approach.querySelectorAll("[data-approach-panel]")];
  controls.hidden = false;
  function select(key) {
    scene.dataset.focus = key;
    controls
      .querySelectorAll("[data-approach]")
      .forEach((button) =>
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.approach === key),
        ),
      );
    panels.forEach(
      (panel) => (panel.hidden = panel.dataset.approachPanel !== key),
    );
  }
  controls
    .querySelectorAll("[data-approach]")
    .forEach((button) =>
      button.addEventListener("click", () => select(button.dataset.approach)),
    );
  select("define");
}
// Motion is finite and never gates access to the content.
if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) =>
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        animateOnce(
          entry.target,
          [{ transform: "translateY(12px)" }, { transform: "translateY(0)" }],
          { duration: 550, easing: "cubic-bezier(.2,.7,.2,1)" },
        );
        observer.unobserve(entry.target);
      }),
    { threshold: 0.1 },
  );
  document
    .querySelectorAll(".support-project,.approach-intro,.case-body>section")
    .forEach((element) => observer.observe(element));
}
document
  .querySelectorAll("[data-year]")
  .forEach((element) => (element.textContent = new Date().getFullYear()));
document.querySelectorAll(".copy-email").forEach((button) => {
  if (!navigator.clipboard || !window.isSecureContext) return;
  button.hidden = false;
  button.addEventListener("click", async () => {
    const status = button.parentElement.querySelector(".copy-status");
    try {
      await navigator.clipboard.writeText("arvindsathyan@gmail.com");
      button.textContent = "Copied ✓";
      status.textContent = "Email address copied.";
    } catch {
      button.textContent = "Use email link";
      status.textContent = "Copy unavailable. Use the email link above.";
    }
    setTimeout(() => (button.textContent = "Copy email"), 2500);
  });
});
