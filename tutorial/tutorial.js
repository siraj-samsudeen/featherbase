// The tutorial's shared frame: the list of lessons on the left, "On this page" on the right,
// a back/next bar, the arrow keys, and coloured code. Each lesson page only loads this file.

const chapters = [
  {
    title: "Chapter 1 · Welcome and Page not found",
    lessons: [
      { file: "lesson-1.html", title: "The first failing test", kind: "red" },
      { file: "lesson-2.html", title: "The least code that passes", kind: "green" },
      { file: "lesson-3.html", title: "A second behaviour: page not found", kind: "red" },
      { file: "lesson-4.html", title: "The least fix for page not found", kind: "green" },
      { file: "lesson-5.html", title: "Changing the tool without changing the behaviour", kind: "refactor" },
      { file: "lesson-6.html", title: "Letting the tests see the code", kind: "refactor" },
      { file: "lesson-7.html", title: "A gate that says no", kind: "chore" },
      { file: "lesson-8.html", title: "Proving the front door", kind: "test" },
      { file: "lesson-9.html", title: "A machine that never forgets", kind: "chore" },
    ],
  },
];

const lessons = chapters.flatMap((chapter) => chapter.lessons);
const here = location.pathname.split("/").pop() || "index.html";
const index = lessons.findIndex((lesson) => lesson.file === here);
const highlighter = "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0";

document.addEventListener("DOMContentLoaded", () => {
  rememberVisit();
  const main = document.querySelector("main");
  const frame = element("div", { class: "frame" });
  main.replaceWith(frame);
  frame.append(lessonList(), main, index >= 0 ? onThisPage(main) : element("div"));
  if (index >= 0) document.body.append(backNextBar());
  colourTheCode(main);
});

document.addEventListener("keydown", (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (event.target.closest?.("input, textarea, select, [contenteditable]")) return;
  const target = { ArrowLeft: lessons[index - 1], ArrowRight: lessons[index + 1] }[event.key];
  if (index >= 0 && target) location.href = target.file;
});

function lessonList() {
  const visited = visits();
  const nav = element("nav", { class: "lessons", "aria-label": "Lessons" });
  const toggle = element("button", { class: "lessons-toggle", type: "button", "aria-expanded": "false" }, "☰ Lessons");
  toggle.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
  });
  nav.append(toggle, element("a", { class: "home", href: "index.html" }, "Building Featherbase test-first"));
  for (const chapter of chapters) {
    const list = element("ol");
    for (const lesson of chapter.lessons) {
      const number = lessons.indexOf(lesson) + 1;
      const link = element("a", { href: lesson.file });
      if (lesson.file === here) link.setAttribute("aria-current", "page");
      link.append(
        element("span", { class: "n" }, visited.has(lesson.file) && lesson.file !== here ? "✓" : String(number)),
        element("span", { class: "t" }, lesson.title),
        element("span", { class: `kind ${lesson.kind}` }, lesson.kind),
      );
      list.append(element("li", {}, link));
    }
    nav.append(element("p", { class: "chapter" }, chapter.title), list);
  }
  return nav;
}

function onThisPage(main) {
  const aside = element("nav", { class: "onpage", "aria-label": "On this page" });
  const list = element("ol");
  const headings = [...main.querySelectorAll("h2")];
  headings.forEach((heading, i) => {
    heading.id ||= `part-${i + 1}`;
    const label = heading.querySelector(".q")?.textContent ?? "";
    const text = [...heading.childNodes].filter((node) => !node.classList?.contains("q")).map((node) => node.textContent).join("").trim();
    const link = element("a", { href: `#${heading.id}` });
    link.append(element("small", {}, label), document.createTextNode(text));
    list.append(element("li", {}, link));
  });
  aside.append(element("p", { class: "chapter" }, "On this page"), list);
  const links = [...list.querySelectorAll("a")];
  const mark = () => {
    let current = 0;
    headings.forEach((heading, i) => {
      if (heading.getBoundingClientRect().top < 140) current = i;
    });
    links.forEach((link, i) => link.classList.toggle("now", i === current));
  };
  addEventListener("scroll", mark, { passive: true });
  requestAnimationFrame(mark);
  return aside;
}

function backNextBar() {
  const back = lessons[index - 1];
  const next = lessons[index + 1];
  const bar = element("nav", { class: "backnext", "aria-label": "Back and next" });
  const link = (target, label, title, side) =>
    element("a", { href: target, class: side }, element("small", {}, label), element("span", {}, title));
  const dots = element("span", { class: "dots", "aria-hidden": "true" });
  const seen = visits();
  lessons.forEach((lesson, i) => dots.append(element("i", { class: i === index ? "now" : seen.has(lesson.file) ? "done" : "" })));
  bar.append(
    back ? link(back.file, `← Lesson ${index}`, back.title, "back") : link("index.html", "←", "All lessons", "back"),
    element("span", { class: "where" }, dots, `${index + 1} of ${lessons.length}`, element("kbd", {}, "←"), element("kbd", {}, "→")),
    next ? link(next.file, `Lesson ${index + 2} →`, next.title, "next-link") : link("index.html", "→", "All lessons", "next-link"),
  );
  return bar;
}

function colourTheCode(main) {
  const blocks = [...main.querySelectorAll("pre > code")].filter((code) => {
    if ([...code.classList].some((name) => name.startsWith("language-"))) return true;
    const language = languageFromContext(code.parentElement);
    if (language) code.classList.add(`language-${language}`);
    return Boolean(language);
  });
  if (blocks.length === 0) return;
  document.head.append(element("link", { rel: "stylesheet", href: `${highlighter}/styles/github-dark.min.css` }));
  const script = element("script", { src: `${highlighter}/highlight.min.js` });
  script.onload = () => blocks.forEach((block) => window.hljs.highlightElement(block));
  document.head.append(script);
}

function languageFromContext(pre) {
  if (pre.classList.contains("out") || pre.classList.contains("ok")) return null;
  const before = pre.previousElementSibling;
  const file = before?.classList.contains("file") ? before.textContent.trim() : "";
  if (/\.(ts|js)$/.test(file)) return "typescript";
  if (/\.json$/.test(file)) return "json";
  if (/\.(ya?ml)$/.test(file)) return "yaml";
  if (/\.md$/.test(file)) return "markdown";
  if (before?.tagName === "H3" && /try it yourself/i.test(before.textContent)) return "bash";
  return null;
}

function rememberVisit() {
  if (index < 0) return;
  try {
    const seen = visits();
    seen.add(here);
    localStorage.setItem("tutorial-visited", JSON.stringify([...seen]));
  } catch {}
}

function visits() {
  try {
    return new Set(JSON.parse(localStorage.getItem("tutorial-visited") ?? "[]"));
  } catch {
    return new Set();
  }
}

function element(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.append(...children);
  return node;
}
