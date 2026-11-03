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
            {
              opacity: 1,
              transform:
                "perspective(1000px) rotateX(-6deg) translateY(9px) translateZ(16px)",
            },
            {
              opacity: 1,
              transform:
                "perspective(1000px) rotateX(0deg) translateY(0) translateZ(0)",
            },
          ],
          { duration: 420, easing: "cubic-bezier(.2,.7,.2,1)" },
        );
    });
  }
  buttons.forEach((button) =>
    button.addEventListener("click", () => select(button.dataset.sample)),
  );
  explorer.addEventListener("sample:select", (event) => {
    if (buttons.some((button) => button.dataset.sample === event.detail))
      select(event.detail);
  });
  explorer.querySelectorAll("[data-sample]").forEach((button) =>
    button.addEventListener("click", () => {
      explorer.dispatchEvent(
        new CustomEvent("artifactchange", { detail: button.dataset.sample }),
      );
    }),
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

// Dimensional previews reflect the same artifacts shown in the worked example.
const packagePreview = document.querySelector(".package-preview");
if (packagePreview) {
  const stage = packagePreview.querySelector(".package-stage");
  const controls = packagePreview.querySelector(".package-controls");
  const captions = {
    spec: "Spec: requirements and acceptance criteria.",
    plan: "Plan: architecture, risks, and an implementation path.",
    harness: "Harness: validation assets before execution.",
    tasks: "Tasks: implementation work linked to requirements.",
  };
  controls.hidden = false;
  function showPackage(key) {
    if (!captions[key]) return;
    stage.dataset.package = key;
    controls
      .querySelectorAll("[data-package-select]")
      .forEach((button) =>
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.packageSelect === key),
        ),
      );
    packagePreview.querySelector(".package-caption").textContent =
      captions[key];
  }
  controls.querySelectorAll("[data-package-select]").forEach((button) =>
    button.addEventListener("click", () => {
      const key = button.dataset.packageSelect;
      showPackage(key);
      document
        .querySelector(".sample-explorer")
        ?.dispatchEvent(new CustomEvent("sample:select", { detail: key }));
    }),
  );
  document
    .querySelector(".sample-explorer")
    ?.addEventListener("artifactchange", (event) => showPackage(event.detail));
}
// Pointer movement changes the viewing angle, never the position of reading text.
document
  .querySelectorAll(".product-capture,.package-stage,.system-scene")
  .forEach((surface) => {
    let frame = 0;
    function reset() {
      cancelAnimationFrame(frame);
      surface.classList.remove("depth-follow");
      surface.style.removeProperty("--pointer-x");
      surface.style.removeProperty("--pointer-y");
    }
    surface.addEventListener("pointermove", (event) => {
      if (
        reducedMotion.matches ||
        event.pointerType !== "mouse" ||
        !matchMedia("(min-width: 761px)").matches
      )
        return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = surface.getBoundingClientRect();
        surface.style.setProperty(
          "--pointer-x",
          String(
            Math.max(
              -1,
              Math.min(1, ((event.clientX - box.left) / box.width) * 2 - 1),
            ),
          ),
        );
        surface.style.setProperty(
          "--pointer-y",
          String(
            Math.max(
              -1,
              Math.min(1, ((event.clientY - box.top) / box.height) * 2 - 1),
            ),
          ),
        );
        surface.classList.add("depth-follow");
      });
    });
    surface.addEventListener("pointerleave", reset);
    surface.addEventListener("pointercancel", reset);
    reducedMotion.addEventListener("change", reset);
  });
