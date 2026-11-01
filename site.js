document
  .querySelectorAll(".stage-controls")
  .forEach((el) => (el.hidden = false));
const stages = [
  {
    file: "SPEC.md",
    caption: "01 — DEFINE THE PROBLEM",
    title: "A clear brief.\nA better build.",
    note: "Requirements & acceptance criteria",
  },
  {
    file: "PLAN.md",
    caption: "02 — CHOOSE THE APPROACH",
    title: "Decisions first.\nFewer surprises.",
    note: "Architecture, risks & implementation path",
  },
  {
    file: "HARNESS",
    caption: "03 — MAKE IT TESTABLE",
    title: "Define success.\nBefore the code.",
    note: "Validation assets & acceptance checks",
  },
  {
    file: "TASKS.md",
    caption: "04 — HAND OFF THE WORK",
    title: "Small tasks.\nA traceable path.",
    note: "Work items linked to requirements",
  },
];
document.querySelectorAll("[data-stage]").forEach((button) =>
  button.addEventListener("click", () => {
    const art = button.closest(".thought-art"),
      stage = stages[Number(button.dataset.stage)];
    art
      .querySelectorAll("[data-stage]")
      .forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
    art.querySelector("[data-file]").textContent = stage.file;
    art.querySelector("[data-stage-caption]").textContent = stage.caption;
    const title = art.querySelector("[data-stage-title]");
    title.replaceChildren();
    stage.title.split("\n").forEach((line, i) => {
      if (i) title.append(document.createElement("br"));
      title.append(document.createTextNode(line));
    });
    art.querySelector("[data-stage-note]").textContent = stage.note;
    art.querySelector("[data-stage-live]").textContent =
      stage.file + ": " + stage.note;
  }),
);
function updateClock() {
  document.querySelectorAll("[data-clock]").forEach((el) => {
    el.textContent =
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date()) + " IST";
  });
}
updateClock();
if (document.querySelector("[data-clock]")) setInterval(updateClock, 60000);
document
  .querySelectorAll("[data-year]")
  .forEach((el) => (el.textContent = new Date().getFullYear()));
const copy = document.querySelector(".copy-email");
if (copy && navigator.clipboard && window.isSecureContext) {
  copy.hidden = false;
  copy.addEventListener("click", async () => {
    const status = document.querySelector(".copy-status");
    try {
      await navigator.clipboard.writeText("arvindsathyan@gmail.com");
      copy.textContent = "Copied ✓";
      status.textContent = "Email address copied to clipboard.";
    } catch {
      copy.textContent = "Copy unavailable";
      status.textContent = "Could not copy. Use the email link above.";
    }
    setTimeout(() => (copy.textContent = "Copy email"), 2500);
  });
}

// Motion enhances visible content; nothing depends on animation to be readable.
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const activeAnimations = new Set();
function animateOnce(element, frames, options) {
  if (reducedMotion.matches || !element.animate) return;
  const animation = element.animate(frames, options);
  activeAnimations.add(animation);
  animation.finished
    .catch(() => {})
    .finally(() => activeAnimations.delete(animation));
}
reducedMotion.addEventListener("change", () => {
  if (reducedMotion.matches)
    activeAnimations.forEach((animation) => animation.cancel());
});
if ("IntersectionObserver" in window) {
  const reveals = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        animateOnce(
          entry.target,
          [
            { opacity: 0.85, transform: "translateY(24px)" },
            { opacity: 1, transform: "translateY(0)" },
          ],
          { duration: 750, easing: "cubic-bezier(.2,.7,.2,1)" },
        );
        reveals.unobserve(entry.target);
      });
    },
    { threshold: 0.12 },
  );
  document
    .querySelectorAll(
      ".section-heading,.project-copy,.about-grid>div,.credentials-title,.credential-list,.contact-heading,.case-body section",
    )
    .forEach((el) => reveals.observe(el));
}
const heroTitle = document.querySelector(".hero h1");
if (heroTitle)
  animateOnce(
    heroTitle,
    [
      { opacity: 0.85, transform: "translateY(20px)" },
      { opacity: 1, transform: "translateY(0)" },
    ],
    { duration: 1000, easing: "cubic-bezier(.2,.7,.2,1)" },
  );

document.querySelectorAll(".project-art").forEach((art) => {
  let frame = 0;
  art.addEventListener("pointermove", (event) => {
    if (
      reducedMotion.matches ||
      event.pointerType !== "mouse" ||
      !matchMedia("(min-width:761px)").matches
    )
      return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const rect = art.getBoundingClientRect();
      art.style.setProperty(
        "--tilt-x",
        `${(0.5 - (event.clientY - rect.top) / rect.height) * 5}deg`,
      );
      art.style.setProperty(
        "--tilt-y",
        `${((event.clientX - rect.left) / rect.width - 0.5) * 7}deg`,
      );
      art.classList.add("is-tilting");
    });
  });
  function resetTilt() {
    cancelAnimationFrame(frame);
    art.classList.remove("is-tilting");
    art.style.removeProperty("--tilt-x");
    art.style.removeProperty("--tilt-y");
  }
  art.addEventListener("pointerleave", resetTilt);
  reducedMotion.addEventListener("change", resetTilt);
});
document.querySelectorAll("[data-stage]").forEach((button) =>
  button.addEventListener("click", () => {
    const paper = button.closest(".thought-art").querySelector(".spec-paper");
    animateOnce(
      paper,
      [
        {
          opacity: 0.65,
          transform: "translateY(7px) rotate(-3deg) rotateY(-12deg)",
        },
        { opacity: 1, transform: "translateY(0) rotate(-3deg) rotateY(0deg)" },
      ],
      { duration: 480, easing: "cubic-bezier(.2,.7,.2,1)" },
    );
  }),
);

// Each spatial layer corresponds to a responsibility explained in readable text.
const approach = document.querySelector(".approach-study");
if (approach) {
  const scene = approach.querySelector(".system-scene");
  const controls = approach.querySelector(".approach-controls");
  const panels = [...approach.querySelectorAll("[data-approach-panel]")];
  controls.hidden = false;
  function selectApproach(key) {
    scene.dataset.focus = key;
    controls.querySelectorAll("[data-approach]").forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.approach === key),
      );
    });
    panels.forEach(
      (panel) => (panel.hidden = panel.dataset.approachPanel !== key),
    );
  }
  controls.querySelectorAll("[data-approach]").forEach((button) => {
    button.addEventListener("click", () =>
      selectApproach(button.dataset.approach),
    );
  });
  selectApproach("define");
}

document.querySelectorAll(".sentinel-art").forEach((art) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "trace-control";
  button.textContent = "Trace a maintenance decision →";
  const description = document.createElement("p");
  description.className = "trace-description";
  description.setAttribute("aria-live", "polite");
  description.textContent =
    "An illustrated workflow, not live plant telemetry.";
  art.append(button, description);
  const steps = [
    "Sensor evidence → 41 versioned features.",
    "Deterministic models → failure risk and remaining life.",
    "Grounded diagnosis → evidence and guardrail checks.",
    "Planner approval → immutable mock ERP work order.",
  ];
  let step = -1;
  button.addEventListener("click", () => {
    step = (step + 1) % steps.length;
    description.textContent = steps[step];
    button.textContent =
      step === 3 ? "Replay the workflow ↺" : `Next step (${step + 1}/4) →`;
    art.classList.remove("trace-active");
    void art.offsetWidth;
    art.classList.add("trace-active");
  });
});
document.querySelectorAll(".covenant-art").forEach((art) => {
  const description = document.createElement("p");
  description.className = "horizon-description";
  description.setAttribute("aria-live", "polite");
  description.textContent =
    "Select a forecast horizon to explore the review window.";
  art.querySelector(".horizons").after(description);
  const notes = {
    30: "30 days · Review the nearest forecast window.",
    60: "60 days · Extend the review into the medium-term window.",
    90: "90 days · Explore the furthest forecast window.",
  };
  art.querySelectorAll(".horizons>div").forEach((cell, i) => {
    const days = [30, 60, 90][i],
      button = document.createElement("button");
    button.type = "button";
    button.className = "horizon-button";
    button.setAttribute("aria-label", `${days}-day forecast horizon`);
    button.setAttribute("aria-pressed", "false");
    while (cell.firstChild) button.append(cell.firstChild);
    cell.append(button);
    button.addEventListener("click", () => {
      art
        .querySelectorAll(".horizon-button")
        .forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
      art.dataset.horizon = days;
      description.textContent =
        notes[days] + " Illustrative curve, not measured performance.";
    });
  });
});
