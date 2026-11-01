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
