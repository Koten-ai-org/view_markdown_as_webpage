/* global marked, mermaid, renderMathInElement, fuzzysort */
(function () {
  "use strict";

  const article = document.getElementById("doc");
  const appEl = document.querySelector(".app");
  const navEl = document.getElementById("nav");
  const navList = document.getElementById("nav-list");
  const navEmpty = document.getElementById("nav-empty");
  const filterInput = document.getElementById("nav-filter");
  const navAll = document.getElementById("nav-all");
  const crumb = document.getElementById("crumb");
  const brand = document.getElementById("brand");
  const brandName = brand.querySelector(".logo-name");
  const toggle = document.getElementById("nav-toggle");
  const zenBtn = document.getElementById("zen-toggle");
  const progressEl = document.getElementById("progress");
  const toTop = document.getElementById("to-top");
  const scrim = document.getElementById("scrim");
  const lightbox = document.getElementById("lightbox");
  const lbStage = document.getElementById("lb-stage");
  const lbCap = document.getElementById("lb-cap");
  const peekEl = document.getElementById("peek");
  const settingsEl = document.getElementById("settings");
  const AI_KEY_MASK = "..........";
  const TYPE_MAX = 3;
  const TYPE_KEY = "mdview-type";
  const ZEN_KEY = "mdview-zen";
  const FOLD_KEY = "mdview-fold";
  const RAIL_W_KEY = "mdview-rail-w";
  const AI_ON_KEY = "mdview-ai";
  const LABEL_KEY = "mdview-nav-label";
  const RAIL_MIN = 180;
  const resizeHandle = document.getElementById("rail-resize");

  const MD_RE = /\.(md|markdown|mdown|mkd)(?:$|[?#])/i;
  const IMAGE_RE = /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico|tiff?|heic|heif)(?:$|[?#])/i;
  const VIDEO_RE = /\.(mp4|webm|ogv|mov|m4v)(?:$|[?#])/i;
  const AUDIO_RE = /\.(mp3|wav|ogg|m4a|flac|aac)(?:$|[?#])/i;
  const PDF_RE = /\.pdf(?:$|[?#])/i;
  const TEXT_RE = /\.(txt|csv|tsv|json|ya?ml|xml|log|rst|adoc|html?|css|js|ts)(?:$|[?#])/i;

  let notes = [];
  let folderTitle = "Markdown";
  let folderKey = "";
  let defaultDoc = "README.md";
  let currentPath = defaultDoc;
  let memoryGen = 0;
  let cardStreamGen = 0;
  let cardStreamTimer = 0;
  let streamedCardKey = "";
  let cardPackByPath = {};
  let lastMemory = null;
  let aiPrompts = [];
  let chatGen = 0;
  let lastChat = null;
  let askClosed = false;
  let metaOpen = false;
  let metaWide = false;
  let metaFocus = null;
  let metaIdeas = [];
  let metaGraphModel = null;
  let metaChart = null;
  let metaGraphGen = 0;
  let metaResizeTimer = 0;
  let echartsPromise = null;
  let activeKeywords = [];
  const KEYWORD_COLORS = [
    "#f08a2a", "#f0b429", "#e2d04a", "#9fd36a",
    "#5cbc7a", "#3dbe9a", "#4ec4e0", "#6bb3f0",
    "#8b9aef", "#b48ae8", "#e07ac8", "#e889b4",
    "#e87a6b", "#ef9a9a",
  ];

  function keywordColor(term) {
    const s = String(term || "").trim().toLowerCase();
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return KEYWORD_COLORS[(h >>> 0) % KEYWORD_COLORS.length];
  }

  marked.setOptions({ gfm: true, breaks: false });
  mermaid.initialize({
    startOnLoad: false,
    theme: "neutral",
    securityLevel: "loose",
    fontFamily: "Inter, sans-serif",
    themeVariables: {
      primaryColor: "#e7f7fd",
      primaryTextColor: "#1f2a38",
      lineColor: "#7b8898",
      secondaryColor: "#f5f8fb",
      tertiaryColor: "#ffffff",
    },
  });

  function dirOf(path) {
    const i = path.lastIndexOf("/");
    return i === -1 ? "" : path.slice(0, i + 1);
  }

  function extOf(path) {
    const clean = (path || "").split("?")[0].split("#")[0];
    const i = clean.lastIndexOf(".");
    return i === -1 ? "" : clean.slice(i + 1).toLowerCase();
  }

  function fileKind(path) {
    if (MD_RE.test(path)) return "md";
    if (IMAGE_RE.test(path)) return "image";
    if (VIDEO_RE.test(path)) return "video";
    if (AUDIO_RE.test(path)) return "audio";
    if (PDF_RE.test(path)) return "pdf";
    if (TEXT_RE.test(path)) return "text";
    return "other";
  }

  function extractMath(md) {
    const slots = [];
    const out = md.replace(/\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)/g, function (match) {
      const i = slots.length;
      slots.push(match);
      return "<!--GRMATH" + i + "-->";
    });
    return { md: out, slots: slots };
  }

  function restoreMath(html, slots) {
    return html.replace(/<!--GRMATH(\d+)-->/g, function (_, n) {
      return slots[Number(n)];
    });
  }

  function encodePath(path) {
    return path.split("/").map(encodeURIComponent).join("/");
  }

  function githubSlug(text) {
    return text
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .replace(/\s+/g, "-");
  }

  function headingLabel(h) {
    const clone = h.cloneNode(true);
    clone.querySelectorAll(".h-anchor").forEach(function (el) {
      el.remove();
    });
    return (clone.textContent || "").trim();
  }

  function slugHeadings(root) {
    const seen = Object.create(null);
    root.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach(function (h) {
      if (h.id) return;
      let slug = githubSlug(headingLabel(h) || "section");
      if (!slug) slug = "section";
      if (seen[slug]) {
        seen[slug] += 1;
        slug = slug + "-" + seen[slug];
      } else {
        seen[slug] = 0;
      }
      h.id = slug;
    });
  }

  function addHeadingAnchors(root) {
    root.querySelectorAll("h1, h2, h3, h4").forEach(function (h) {
      if (!h.id || h.querySelector(".h-anchor")) return;
      const a = document.createElement("a");
      a.className = "h-anchor";
      a.href = "#" + h.id;
      a.textContent = "#";
      a.setAttribute("aria-label", "Link to this section");
      h.appendChild(a);
    });
  }

  function insertToc(root) {
    const heads = Array.prototype.slice.call(root.querySelectorAll("h2, h3"));
    if (heads.length < 2) return;
    const nav = document.createElement("nav");
    nav.className = "toc";
    nav.setAttribute("aria-label", "On this page");
    const k = document.createElement("p");
    k.className = "toc-kicker";
    k.textContent = "On this page";
    nav.appendChild(k);
    const ul = document.createElement("ul");
    heads.forEach(function (h) {
      if (!h.id) return;
      const li = document.createElement("li");
      if (h.tagName === "H3") li.className = "toc-h3";
      const a = document.createElement("a");
      a.href = "#" + h.id;
      a.textContent = headingLabel(h);
      li.appendChild(a);
      ul.appendChild(li);
    });
    nav.appendChild(ul);
    const h1 = root.querySelector("h1");
    if (h1 && h1.nextSibling) h1.parentNode.insertBefore(nav, h1.nextSibling);
    else root.insertBefore(nav, root.firstChild);
  }

  function wrapTables(root) {
    root.querySelectorAll("table").forEach(function (table) {
      if (table.parentElement && table.parentElement.classList.contains("table-wrap")) return;
      const wrap = document.createElement("div");
      wrap.className = "table-wrap";
      table.parentNode.insertBefore(wrap, table);
      wrap.appendChild(table);
    });
  }

  function fallbackCopy(text, ok) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      ok();
    } catch (e) { /* ignore */ }
    ta.remove();
  }

  function wrapCode(root) {
    root.querySelectorAll("pre").forEach(function (pre) {
      if (pre.parentElement && pre.parentElement.classList.contains("code-wrap")) return;
      const wrap = document.createElement("div");
      wrap.className = "code-wrap";
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(pre);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "copy-btn";
      btn.textContent = "Copy";
      btn.addEventListener("click", function () {
        const text = pre.textContent || "";
        function ok() {
          btn.textContent = "Copied";
          setTimeout(function () {
            btn.textContent = "Copy";
          }, 1400);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(ok).catch(function () {
            fallbackCopy(text, ok);
          });
        } else {
          fallbackCopy(text, ok);
        }
      });
      wrap.appendChild(btn);
    });
  }

  function classify(href, current) {
    if (!href || href.startsWith("javascript:")) return { kind: "skip" };
    if (href.startsWith("mailto:") || href.startsWith("tel:")) return { kind: "ext", url: href, host: href.split(":")[0] };
    if (href.startsWith("#")) return { kind: "hash", hash: href.slice(1) };
    if (/^https?:\/\//i.test(href) || href.startsWith("//")) {
      try {
        const abs = new URL(href, location.href);
        return { kind: "ext", url: abs.href, host: abs.hostname.replace(/^www\./, "") };
      } catch (e) {
        return { kind: "skip" };
      }
    }
    try {
      const base = "https://notes.local/" + dirOf(current);
      const u = new URL(href, base);
      const path = decodeURIComponent(u.pathname.replace(/^\//, ""));
      const hash = (u.hash || "").replace(/^#/, "");
      const kind = fileKind(path);
      if (kind === "md") return { kind: "local", path: path, hash: hash };
      return { kind: "file", path: path, file: kind, hash: hash };
    } catch (e) {
      return { kind: "skip" };
    }
  }

  function decorateLinks(root, current) {
    root.querySelectorAll("a[href]").forEach(function (a) {
      const href = a.getAttribute("href");
      const info = classify(href, current);
      if (info.kind === "skip" || info.kind === "hash") return;
      if (info.kind === "local") {
        a.classList.add("link-local");
        const next = "?doc=" + encodeURIComponent(info.path) + (info.hash ? "#" + info.hash : "");
        a.setAttribute("href", next);
        a.addEventListener("click", function (ev) {
          if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button !== 0) return;
          ev.preventDefault();
          closeNav();
          loadDoc(info.path, info.hash, false);
        });
        return;
      }
      if (info.kind === "file") {
        a.classList.add("link-file");
        const url = "/" + encodePath(info.path);
        a.setAttribute("href", url);
        if (!a.querySelector(".file-kind") && info.file && info.file !== "other") {
          const chip = document.createElement("span");
          chip.className = "file-kind";
          chip.textContent = extOf(info.path) || info.file;
          a.appendChild(chip);
        }
        a.addEventListener("click", function (ev) {
          if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button !== 0) return;
          if (info.file === "image" || info.file === "video" || info.file === "pdf") {
            ev.preventDefault();
            openLightbox({ type: info.file, src: url, alt: a.textContent.replace(/\s+\w+$/, "").trim() });
          }
        });
        return;
      }
      if (info.kind === "ext") {
        a.classList.add("link-ext");
        a.setAttribute("target", "_blank");
        a.setAttribute("rel", "noopener noreferrer");
        if (info.host && !a.querySelector(".ext-host")) {
          const chip = document.createElement("span");
          chip.className = "ext-host";
          chip.textContent = info.host;
          a.appendChild(chip);
        }
      }
    });
  }

  const peekCache = Object.create(null);
  let peekTimer = 0;
  let peekHideTimer = 0;
  let peekGen = 0;
  let peekAnchor = null;

  function canHoverPeek() {
    return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  }

  function hidePeek() {
    clearTimeout(peekTimer);
    clearTimeout(peekHideTimer);
    peekAnchor = null;
    if (peekEl) peekEl.hidden = true;
  }

  function scheduleHidePeek() {
    clearTimeout(peekHideTimer);
    peekHideTimer = setTimeout(hidePeek, 160);
  }

  function sanitizePeekHtml(html) {
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    tmp.querySelectorAll("script, iframe, object, embed, form, video, audio, style, .h-anchor").forEach(function (el) {
      el.remove();
    });
    tmp.querySelectorAll("*").forEach(function (el) {
      Array.prototype.slice.call(el.attributes).forEach(function (attr) {
        if (/^on/i.test(attr.name) || ((attr.name === "href" || attr.name === "src") && /^\s*javascript:/i.test(attr.value))) {
          el.removeAttribute(attr.name);
        }
      });
    });
    tmp.querySelectorAll("a").forEach(function (a) {
      a.setAttribute("tabindex", "-1");
    });
    tmp.querySelectorAll("img").forEach(function (img, i) {
      if (i > 0) img.remove();
    });
    tmp.querySelectorAll("table").forEach(function (table, i) {
      if (i > 0) {
        table.remove();
        return;
      }
      table.querySelectorAll("tr").forEach(function (row, j) {
        if (j > 4) row.remove();
      });
    });
    tmp.querySelectorAll("pre, .mermaid, .toc").forEach(function (el) {
      el.remove();
    });
    return tmp.innerHTML;
  }

  function mdWindow(md, hash) {
    const lines = md.split(/\r?\n/);
    let start = 0;
    let title = "";
    let level = 1;
    if (hash) {
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
        if (!m) continue;
        if (githubSlug(m[2]) === hash) {
          start = i;
          title = m[2].trim();
          level = m[1].length;
          break;
        }
      }
    }
    if (!title) {
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^#\s+(.+)$/);
        if (m) {
          title = m[1].trim();
          start = i;
          break;
        }
      }
    }
    const chunk = [];
    let chars = 0;
    for (let i = start; i < lines.length; i++) {
      if (i === start && title && /^#{1,6}\s+/.test(lines[i])) continue;
      if (i > start) {
        const m = lines[i].match(/^(#{1,6})\s+/);
        if (m && hash && m[1].length <= level) break;
        if (m && !hash && m[1].length === 1) break;
      }
      chunk.push(lines[i]);
      chars += lines[i].length;
      if (chars > 900 && chunk.length > 6) break;
    }
    return { title: title, md: chunk.join("\n").replace(/```[\s\S]*?```/g, "") };
  }

  function htmlFromSection(id) {
    const el = document.getElementById(id);
    if (!el) return null;
    const wrap = document.createElement("div");
    let n = el.nextElementSibling;
    let count = 0;
    while (n && count < 6) {
      if (/^H[1-6]$/.test(n.tagName)) break;
      if (n.classList && (n.classList.contains("toc") || n.classList.contains("code-wrap"))) {
        n = n.nextElementSibling;
        continue;
      }
      wrap.appendChild(n.cloneNode(true));
      count += 1;
      if ((wrap.innerText || "").length > 520) break;
      n = n.nextElementSibling;
    }
    return {
      title: headingLabel(el),
      html: sanitizePeekHtml(wrap.innerHTML),
    };
  }

  function placePeek(anchor) {
    if (!peekEl || !anchor) return;
    peekEl.hidden = false;
    const r = anchor.getBoundingClientRect();
    const pw = peekEl.offsetWidth;
    const ph = peekEl.offsetHeight;
    const inRail = !!(navEl && navEl.contains(anchor));
    peekEl.classList.toggle("peek-rail", inRail);
    let top;
    let left;
    if (inRail) {
      const railBox = navEl.getBoundingClientRect();
      left = railBox.right + 12;
      top = r.top;
      if (left + pw > window.innerWidth - 12) {
        left = Math.max(railBox.right + 8, window.innerWidth - pw - 12);
      }
      if (top + ph > window.innerHeight - 12) top = window.innerHeight - ph - 12;
      if (top < 12) top = 12;
    } else {
      top = r.bottom + 10;
      left = r.left;
      if (top + ph > window.innerHeight - 12) top = r.top - ph - 10;
      if (left + pw > window.innerWidth - 12) left = window.innerWidth - pw - 12;
      if (left < 12) left = 12;
      if (top < 12) top = 12;
    }
    peekEl.style.top = Math.round(top) + "px";
    peekEl.style.left = Math.round(left) + "px";
  }

  function usablePeekImage(url) {
    if (!url) return "";
    if (/icon[-_.]|favicon|apple-touch|\/logo\b/i.test(url)) return "";
    return url;
  }

  function fillPeek(data) {
    peekEl.innerHTML = "";
    peekEl.className = "peek peek-" + (data.kind || "note");
    const image = usablePeekImage(data.image);
    if (image) {
      const img = document.createElement("img");
      img.className = "peek-media";
      img.src = image;
      img.alt = "";
      img.addEventListener("load", function () {
        if (peekAnchor) placePeek(peekAnchor);
      });
      peekEl.appendChild(img);
    }
    const k = document.createElement("p");
    k.className = "peek-kicker";
    k.textContent = data.kicker || "";
    peekEl.appendChild(k);
    if (data.title) {
      const t = document.createElement("p");
      t.className = "peek-title";
      t.textContent = data.title;
      peekEl.appendChild(t);
    }
    const body = document.createElement("div");
    body.className = "peek-body";
    if (data.html) body.innerHTML = data.html;
    else body.textContent = data.body || "";
    peekEl.appendChild(body);
  }

  function peekTarget(a) {
    if (!a) return null;
    const href = a.getAttribute("href") || "";
    if (!href || href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("tel:")) return null;
    if (a.dataset.path) return { kind: "local", path: a.dataset.path, hash: "" };
    if (a.classList.contains("link-local")) {
      try {
        const u = new URL(a.getAttribute("href"), location.href);
        return { kind: "local", path: u.searchParams.get("doc") || "", hash: (u.hash || "").replace(/^#/, "") };
      } catch (e) {
        return null;
      }
    }
    if (a.classList.contains("link-file")) {
      const path = (a.getAttribute("href") || "").replace(/^\//, "");
      return { kind: "file", path: path, file: fileKind(path) };
    }
    if (a.classList.contains("link-ext")) {
      return { kind: "ext", url: a.href, host: (a.querySelector(".ext-host") && a.querySelector(".ext-host").textContent) || "" };
    }
    if (href.charAt(0) === "#") return { kind: "hash", hash: href.slice(1) };
    return null;
  }

  async function fetchNoteText(path) {
    if (peekCache[path]) return peekCache[path];
    const res = await fetch("/" + encodePath(path), { cache: "no-store" });
    if (!res.ok) throw new Error("missing");
    const md = await res.text();
    peekCache[path] = md;
    return md;
  }

  async function showPeek(a) {
    if (!peekEl || !canHoverPeek() || lightbox.hidden === false) return;
    const info = peekTarget(a);
    if (!info) return;
    peekAnchor = a;
    const gen = ++peekGen;
    fillPeek({ kind: info.kind === "ext" ? "ext" : "note", kicker: "Loading", title: "", body: "…" });
    placePeek(a);
    try {
      if (info.kind === "hash" || (info.kind === "local" && info.path === currentPath && info.hash)) {
        const section = htmlFromSection(info.hash);
        if (section && gen === peekGen) {
          fillPeek({
            kind: "note",
            kicker: "On this page",
            title: section.title,
            html: section.html,
          });
          placePeek(a);
          return;
        }
      }
      if (info.kind === "local") {
        const md = await fetchNoteText(info.path);
        if (gen !== peekGen) return;
        const win = mdWindow(md, info.hash);
        const extracted = extractMath(win.md);
        const html = sanitizePeekHtml(restoreMath(marked.parse(extracted.md), extracted.slots));
        const meta = findNote(info.path);
        fillPeek({
          kind: "note",
          kicker: info.hash ? "Note · section" : "Note",
          title: win.title || (meta && meta.title) || info.path,
          html: html,
        });
        placePeek(a);
        return;
      }
      if (info.kind === "file") {
        if (info.file === "image") {
          fillPeek({
            kind: "file",
            kicker: extOf(info.path) || "image",
            title: info.path.split("/").pop(),
            image: "/" + encodePath(fullSrc(info.path)),
            body: "",
          });
        } else {
          fillPeek({
            kind: "file",
            kicker: "Local file",
            title: info.path.split("/").pop(),
            body: (extOf(info.path) || info.file) + " — click to open",
          });
        }
        placePeek(a);
        return;
      }
      if (info.kind === "ext") {
        const res = await fetch("/api/preview?url=" + encodeURIComponent(info.url), { cache: "no-store" });
        if (gen !== peekGen) return;
        const data = res.ok ? await res.json() : {};
        fillPeek({
          kind: "ext",
          kicker: data.host || info.host || "External",
          title: data.title || info.host || info.url,
          body: data.description || info.url,
          image: data.image || "",
        });
        placePeek(a);
      }
    } catch (err) {
      if (gen !== peekGen) return;
      fillPeek({ kind: "note", kicker: "Preview", title: "", body: "Could not load a preview." });
      placePeek(a);
    }
  }

  function schedulePeek(a) {
    if (!canHoverPeek() || !a) return;
    clearTimeout(peekHideTimer);
    if (peekAnchor === a && peekEl && !peekEl.hidden) return;
    clearTimeout(peekTimer);
    peekTimer = setTimeout(function () {
      showPeek(a);
    }, 280);
  }

  function bindPeekRoot(root) {
    if (!root) return;
    root.addEventListener("pointerover", function (ev) {
      const a = ev.target.closest("a[href]");
      if (!a || !root.contains(a)) return;
      schedulePeek(a);
    });
    root.addEventListener("pointerout", function (ev) {
      const a = ev.target.closest("a[href]");
      if (!a) return;
      const rel = ev.relatedTarget;
      if (rel && (a.contains(rel) || (peekEl && peekEl.contains(rel)))) return;
      scheduleHidePeek();
    });
  }

  function fullSrc(src) {
    return (src || "").replace("/thumbs/", "/");
  }

  function openLightbox(opts) {
    hideSelMenu();
    lbStage.innerHTML = "";
    const type = opts.type || "image";
    const src = fullSrc(opts.src);
    if (type === "video") {
      const v = document.createElement("video");
      v.src = src;
      v.controls = true;
      v.autoplay = true;
      v.addEventListener("click", function (ev) { ev.stopPropagation(); });
      lbStage.appendChild(v);
    } else if (type === "pdf") {
      const f = document.createElement("iframe");
      f.src = src;
      f.title = opts.alt || "PDF";
      f.addEventListener("click", function (ev) { ev.stopPropagation(); });
      lbStage.appendChild(f);
    } else {
      const img = document.createElement("img");
      img.src = src;
      img.alt = opts.alt || "";
      img.addEventListener("click", function (ev) { ev.stopPropagation(); });
      lbStage.appendChild(img);
    }
    lbCap.textContent = opts.alt || "";
    lightbox.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeLightbox() {
    lightbox.hidden = true;
    lbStage.innerHTML = "";
    document.body.style.overflow = "";
  }

  function enhanceMedia(root) {
    root.querySelectorAll("img[src]").forEach(function (img) {
      const src = img.getAttribute("src") || "";
      const kind = fileKind(src);
      if (kind === "video") {
        const v = document.createElement("video");
        v.src = src;
        v.controls = true;
        v.preload = "metadata";
        if (img.alt) v.setAttribute("aria-label", img.alt);
        img.replaceWith(v);
        v.addEventListener("click", function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          openLightbox({ type: "video", src: v.currentSrc || src, alt: img.alt || "" });
        });
        return;
      }
      if (kind === "audio") {
        const a = document.createElement("audio");
        a.src = src;
        a.controls = true;
        img.replaceWith(a);
        return;
      }
      if (kind === "pdf") {
        const f = document.createElement("iframe");
        f.src = src;
        f.className = "media-frame";
        f.title = img.alt || "PDF";
        img.replaceWith(f);
        f.addEventListener("click", function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          openLightbox({ type: "pdf", src: src, alt: img.alt || "" });
        });
        return;
      }
      img.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        openLightbox({ type: "image", src: img.currentSrc || src, alt: img.alt || "" });
      });
    });
    root.querySelectorAll("video").forEach(function (v) {
      v.controls = true;
      v.addEventListener("click", function (ev) {
        if (ev.target !== v) return;
      });
    });
    root.querySelectorAll("audio").forEach(function (a) {
      a.controls = true;
    });
  }

  function promoteMermaid(root) {
    root.querySelectorAll("pre code.language-mermaid").forEach(function (code) {
      const pre = code.parentElement;
      const div = document.createElement("div");
      div.className = "mermaid";
      div.textContent = code.textContent;
      if (pre) pre.replaceWith(div);
    });
  }

  function rewriteRelativeMedia(root, current) {
    const prefix = dirOf(current);
    if (!prefix) return;
    root.querySelectorAll("img[src], video[src], audio[src], source[src], iframe[src]").forEach(function (el) {
      const val = el.getAttribute("src");
      if (!val || /^(https?:|\/\/|data:|\/|blob:)/i.test(val)) return;
      el.setAttribute("src", prefix + val);
    });
  }

  function routeFromLocation() {
    const params = new URLSearchParams(location.search);
    const doc = params.get("doc") || defaultDoc;
    const hash = (location.hash || "").replace(/^#/, "");
    return { path: doc, hash: hash };
  }

  function setRoute(path, hash, replace) {
    const url = new URL(location.href);
    url.searchParams.set("doc", path);
    url.hash = hash || "";
    const fn = replace ? "replaceState" : "pushState";
    history[fn]({ path: path, hash: hash || "" }, "", url);
  }

  function findNote(path) {
    for (let i = 0; i < notes.length; i++) {
      if (notes[i].path === path) return notes[i];
    }
    return null;
  }

  function noteIndex(path) {
    for (let i = 0; i < notes.length; i++) {
      if (notes[i].path === path) return i;
    }
    return -1;
  }

  function neighbor(delta) {
    const i = noteIndex(currentPath);
    if (i < 0) return;
    const n = notes[i + delta];
    if (n) loadDoc(n.path, "", false);
  }

  function markActive(path) {
    navList.querySelectorAll(".nav-group-body a").forEach(function (a) {
      a.classList.toggle("active", a.dataset.path === path);
      if (a.dataset.path === path) {
        const sec = a.closest(".nav-group");
        if (sec && sec.classList.contains("is-collapsed")) setCollapsed(sec, false);
      }
    });
  }

  function scrollToHash(hash) {
    if (!hash) {
      window.scrollTo(0, 0);
      updateChrome();
      return;
    }
    const id = decodeURIComponent(hash);
    const el = document.getElementById(id);
    if (!el) {
      window.scrollTo(0, 0);
      updateChrome();
      return;
    }
    const header = document.querySelector(".top");
    const offset = header ? header.getBoundingClientRect().height + 12 : 64;
    const top = el.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo(0, Math.max(0, top));
    updateChrome();
  }

  async function loadDoc(path, hash, replace) {
    if (path !== currentPath) activeKeywords = [];
    currentPath = path;
    setRoute(path, hash, replace);
    markActive(path);
    syncRunDoc();
    const meta = findNote(path);
    crumb.textContent = meta ? meta.title : path;
    document.title = (meta ? meta.title : path) + " · " + folderTitle;
    hidePeek();
    hideSelMenu();
    beginMemory();
    syncMemory(path);
    article.innerHTML = "<p>Loading…</p>";
    try {
      const res = await fetch("/" + encodePath(path), { cache: "no-store" });
      if (!res.ok) throw new Error("Could not load " + path + " (" + res.status + ")");
      const md = await res.text();
      const extracted = extractMath(md);
      article.innerHTML = restoreMath(marked.parse(extracted.md), extracted.slots);
      rewriteRelativeMedia(article, path);
      slugHeadings(article);
      wrapTables(article);
      insertToc(article);
      addHeadingAnchors(article);
      decorateLinks(article, path);
      enhanceMedia(article);
      promoteMermaid(article);
      wrapCode(article);
      if (article.querySelector(".mermaid")) {
        try {
          await mermaid.run({ querySelector: "#doc .mermaid" });
        } catch (mmdErr) {
          console.warn("mermaid", mmdErr);
        }
      }
      if (typeof renderMathInElement === "function") {
        renderMathInElement(article, {
          delimiters: [
            { left: "\\[", right: "\\]", display: true },
            { left: "\\(", right: "\\)", display: false },
          ],
          throwOnError: false,
        });
      }
      applyKeywordHighlights();
      refreshMeta();
      requestAnimationFrame(function () {
        scrollToHash(hash);
      });
    } catch (err) {
      if (defaultDoc && path !== defaultDoc && findNote(defaultDoc)) {
        await loadDoc(defaultDoc, "", true);
        return;
      }
      article.innerHTML =
        '<div class="err"><p><strong>Could not load this note.</strong></p><p>' +
        String(err.message || err) +
        '</p><p>Use <a href="/">Folders</a> to pick a notes folder.</p></div>';
      hideMemory();
    }
  }

  function hideMemory() {
    lastMemory = null;
    streamedCardKey = "";
    stopCardStream();
    activeKeywords = [];
    clearKeywordHighlights();
    const el = document.getElementById("memory");
    if (el) el.hidden = true;
    disposeMetaChart();
  }

  function stopCardStream() {
    cardStreamGen += 1;
    if (cardStreamTimer) {
      clearTimeout(cardStreamTimer);
      cardStreamTimer = 0;
    }
  }

  function prefersLessMotion() {
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (err) {
      return false;
    }
  }

  function hasCardContent(doc) {
    if (!doc) return false;
    if ((doc.tldr || []).some(function (item) { return String(item || "").trim(); })) return true;
    if (String(doc.important || "").trim()) return true;
    if (String(doc.next_action || "").trim()) return true;
    return false;
  }

  function cardPackKey(doc) {
    return currentPath + "\0" + String((doc && doc.sha256) || "");
  }

  function rememberCardPack(path, doc) {
    if (!path || !hasCardContent(doc)) return;
    cardPackByPath[path] = {
      tldr: (doc.tldr || []).slice(),
      important: String(doc.important || ""),
      next_action: String(doc.next_action || ""),
      sha256: String(doc.sha256 || ""),
    };
  }

  function cachedCardPack(path) {
    const cached = cardPackByPath[path];
    return cached && hasCardContent(cached) ? cached : null;
  }

  function waitBars() {
    return '<div class="memory-wait" role="status" aria-label="Filling from the model">' +
      "<span></span><span></span><span></span></div>";
  }

  function waitingCardsHtml() {
    return (
      '<article class="memory-card is-waiting"><h3>TL;DR</h3>' + waitBars() + "</article>" +
      '<article class="memory-card is-waiting"><h3>Important idea</h3>' + waitBars() + "</article>" +
      '<article class="memory-card is-waiting"><h3>Next action</h3>' + waitBars() + "</article>"
    );
  }

  function streamTokens(text) {
    return String(text || "").match(/\S+\s*/g) || [];
  }

  function cardsHtml(doc, data) {
    const tldr = (doc && doc.tldr) || [];
    let tldrHtml;
    if (tldr.length) {
      tldrHtml = "<ul>" + tldr.map(function (item) { return "<li>" + escapeHtml(item) + "</li>"; }).join("") + "</ul>";
    } else if (data && data.error) {
      tldrHtml = '<p class="memory-empty">' + escapeHtml(data.error) + "</p>";
    } else {
      tldrHtml = waitBars();
    }
    const next = doc && doc.next_action
      ? "<p>" + escapeHtml(doc.next_action) + "</p>"
      : (data && data.error ? '<p class="memory-empty">—</p>' : waitBars());
    const idea = doc && doc.important
      ? "<p>" + escapeHtml(doc.important) + "</p>"
      : (data && data.error ? '<p class="memory-empty">—</p>' : waitBars());
    return (
      '<article class="memory-card"><h3>TL;DR</h3>' + tldrHtml + "</article>" +
      '<article class="memory-card"><h3>Important idea</h3>' + idea + "</article>" +
      '<article class="memory-card"><h3>Next action</h3>' + next + "</article>"
    );
  }

  function showWaitingCards() {
    const cards = document.getElementById("memory-cards");
    if (!cards) return;
    cards.hidden = false;
    cards.setAttribute("aria-busy", "true");
    if (!cards.querySelector(".memory-wait")) cards.innerHTML = waitingCardsHtml();
  }

  function fillCardsInstant(doc, data) {
    const cards = document.getElementById("memory-cards");
    if (!cards) return;
    stopCardStream();
    cards.innerHTML = cardsHtml(doc, data);
    if (hasCardContent(doc)) cards.removeAttribute("aria-busy");
    else if (data && data.error) cards.removeAttribute("aria-busy");
    else cards.setAttribute("aria-busy", "true");
  }

  function streamCards(doc, data) {
    const cards = document.getElementById("memory-cards");
    if (!cards) return;
    if (prefersLessMotion()) {
      fillCardsInstant(doc, data);
      return;
    }
    const tldr = ((doc && doc.tldr) || []).map(function (item) { return String(item || "").trim(); }).filter(Boolean);
    const idea = String((doc && doc.important) || "").trim();
    const next = String((doc && doc.next_action) || "").trim();
    stopCardStream();
    const gen = cardStreamGen;
    cards.setAttribute("aria-busy", "true");
    cards.innerHTML =
      '<article class="memory-card" data-card="tldr"><h3>TL;DR</h3><div class="memory-card-body"></div></article>' +
      '<article class="memory-card" data-card="idea"><h3>Important idea</h3><div class="memory-card-body"></div></article>' +
      '<article class="memory-card" data-card="next"><h3>Next action</h3><div class="memory-card-body"></div></article>';

    function makeTrack(name, kind, texts) {
      return {
        body: cards.querySelector('[data-card="' + name + '"] .memory-card-body'),
        kind: kind,
        texts: texts,
        tokens: texts.length ? streamTokens(texts[0]) : [],
        item: 0,
        tok: 0,
        node: null,
        list: null,
        caret: null,
        done: !texts.length,
      };
    }

    function startNode(track) {
      if (track.kind === "ul") {
        if (!track.list) {
          track.list = document.createElement("ul");
          track.body.appendChild(track.list);
        }
        track.node = document.createElement("li");
        track.list.appendChild(track.node);
      } else {
        track.node = document.createElement("p");
        track.body.appendChild(track.node);
      }
      track.caret = document.createElement("span");
      track.caret.className = "memory-caret";
      track.caret.setAttribute("aria-hidden", "true");
      track.node.appendChild(track.caret);
    }

    const tracks = [
      makeTrack("tldr", "ul", tldr),
      makeTrack("idea", "p", idea ? [idea] : []),
      makeTrack("next", "p", next ? [next] : []),
    ];
    tracks.forEach(function (track) {
      if (track.done) {
        track.body.innerHTML = '<p class="memory-empty">—</p>';
        return;
      }
      startNode(track);
    });

    function writeTrack(track) {
      if (track.done) return false;
      const token = track.tokens[track.tok];
      if (token == null) {
        if (track.caret && track.caret.parentNode) track.caret.parentNode.removeChild(track.caret);
        track.caret = null;
        track.item += 1;
        track.tok = 0;
        if (track.item >= track.texts.length) {
          track.done = true;
          return false;
        }
        track.tokens = streamTokens(track.texts[track.item]);
        startNode(track);
        return true;
      }
      track.tok += 1;
      track.node.insertBefore(document.createTextNode(token), track.caret);
      return true;
    }

    function tick() {
      if (gen !== cardStreamGen) return;
      let busy = false;
      tracks.forEach(function (track) {
        if (writeTrack(track)) busy = true;
      });
      if (busy) {
        cardStreamTimer = setTimeout(tick, 22);
      } else {
        cardStreamTimer = 0;
        cards.removeAttribute("aria-busy");
      }
    }
    tick();
  }

  function renderCards(doc, data) {
    const cards = document.getElementById("memory-cards");
    if (!cards) return;
    if (!aiEnabled()) {
      stopCardStream();
      cards.hidden = true;
      cards.removeAttribute("aria-busy");
      return;
    }
    cards.hidden = false;
    if (hasCardContent(doc)) {
      const key = cardPackKey(doc);
      rememberCardPack(currentPath, doc);
      if (key && key === streamedCardKey && !cards.querySelector(".memory-wait")) return;
      streamedCardKey = key;
      if (data && data.enriched && !prefersLessMotion()) streamCards(doc, data);
      else fillCardsInstant(doc, data);
      return;
    }
    streamedCardKey = "";
    if (currentPath) delete cardPackByPath[currentPath];
    stopCardStream();
    if (data && data.error) {
      fillCardsInstant(doc, data);
      return;
    }
    showWaitingCards();
  }

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function keywordIsOn(term) {
    const low = String(term || "").toLowerCase();
    return activeKeywords.some(function (t) { return t.toLowerCase() === low; });
  }

  function keywordPattern(term) {
    const raw = String(term || "").trim();
    const parts = raw.split(/\s+/).filter(Boolean).map(escapeRegExp);
    if (!parts.length) return null;
    let src = parts.join("\\s+");
    if (/^\w/i.test(raw)) src = "\\b" + src;
    if (/\w$/i.test(raw)) src = src + "\\b";
    return new RegExp(src, "gi");
  }

  function skipKeywordNode(node) {
    let el = node && node.nodeType === 1 ? node : node.parentElement;
    while (el && el !== article) {
      const tag = (el.tagName || "").toLowerCase();
      if (tag === "pre" || tag === "code" || tag === "script" || tag === "style" || tag === "svg" || tag === "textarea") {
        return true;
      }
      if (el.classList && (el.classList.contains("katex") || el.classList.contains("mermaid") || el.classList.contains("kw-hit"))) {
        return true;
      }
      el = el.parentElement;
    }
    return false;
  }

  function wrapKeywordIn(root, term) {
    const re = keywordPattern(term);
    if (!root || !re) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!node.nodeValue || !String(node.nodeValue).trim()) return NodeFilter.FILTER_REJECT;
        if (skipKeywordNode(node)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (node) {
      const text = node.nodeValue;
      re.lastIndex = 0;
      if (!re.test(text)) return;
      re.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0;
      let m;
      while ((m = re.exec(text))) {
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        const mark = document.createElement("mark");
        mark.className = "kw-hit";
        mark.setAttribute("data-kw", term);
        mark.style.setProperty("--kw", keywordColor(term));
        mark.textContent = m[0];
        frag.appendChild(mark);
        last = m.index + m[0].length;
        if (!m[0].length) break;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    });
  }

  function unwrapKeyword(root, term) {
    if (!root) return;
    const low = String(term || "").toLowerCase();
    root.querySelectorAll("mark.kw-hit").forEach(function (el) {
      if (String(el.getAttribute("data-kw") || "").toLowerCase() !== low) return;
      const parent = el.parentNode;
      if (!parent) return;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
      parent.normalize();
    });
  }

  function clearKeywordHighlights() {
    if (!article) return;
    article.querySelectorAll("mark.kw-hit").forEach(function (el) {
      const parent = el.parentNode;
      if (!parent) return;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
      parent.normalize();
    });
  }

  function applyKeywordHighlights() {
    clearKeywordHighlights();
    activeKeywords.forEach(function (term) {
      wrapKeywordIn(article, term);
    });
  }

  function setKeywordActive(term, on) {
    const key = String(term || "").trim();
    if (!key) return;
    const low = key.toLowerCase();
    let idx = -1;
    activeKeywords.forEach(function (t, i) {
      if (t.toLowerCase() === low) idx = i;
    });
    if (on && idx < 0) activeKeywords.push(key);
    if (!on && idx >= 0) activeKeywords.splice(idx, 1);
    if (on) wrapKeywordIn(article, key);
    else unwrapKeyword(article, key);
  }

  function renderMemoryActions() {
    const el = document.getElementById("memory-actions");
    const askBtn = document.getElementById("memory-ask-toggle");
    const on = aiEnabled();
    if (el) {
      el.hidden = !on;
      if (on) {
        const chips = (aiPrompts || []).filter(function (p) {
          return p && p.id && p.id !== "ask";
        }).map(function (p) {
          return '<button type="button" class="memory-action" data-preset="' +
            escapeHtml(p.id) + '">' + escapeHtml(p.label || p.id) + "</button>";
        }).join("");
        el.innerHTML = chips ? '<span class="memory-label">Actions</span>' + chips : "";
      }
    }
    if (askBtn) askBtn.hidden = !on;
    if (!on) {
      const ask = document.getElementById("memory-ask");
      if (ask) ask.hidden = true;
      const copyBtn = document.getElementById("memory-chat-copy");
      if (copyBtn) copyBtn.hidden = true;
    }
    syncAskToggle();
    syncMetaToggle();
  }

  function noteWordCount() {
    const text = String((article && article.innerText) || "").replace(/\s+/g, " ").trim();
    if (!text || text === "Loading…") return 0;
    return text.split(" ").length;
  }

  function externalHosts() {
    const seen = Object.create(null);
    const out = [];
    if (!article) return out;
    article.querySelectorAll("a.link-ext[href]").forEach(function (a) {
      let host = "";
      try {
        host = new URL(a.href).hostname.replace(/^www\./, "");
      } catch (err) {
        host = "";
      }
      if (!host || seen[host]) return;
      seen[host] = true;
      out.push(host);
    });
    return out;
  }

  function shortLabel(text, n) {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    if (clean.length <= n) return clean;
    return clean.slice(0, n - 1) + "…";
  }

  function syncMetaToggle() {
    const btn = document.getElementById("memory-meta-toggle");
    const panel = document.getElementById("memory-meta");
    if (btn) btn.setAttribute("aria-expanded", metaOpen ? "true" : "false");
    if (panel) panel.hidden = !metaOpen;
  }

  function disposeMetaChart() {
    metaGraphGen += 1;
    if (metaChart) {
      metaChart.dispose();
      metaChart = null;
    }
  }

  function setMetaOpen(open) {
    metaOpen = !!open;
    syncMetaToggle();
    if (!metaOpen) {
      disposeMetaChart();
      return;
    }
    refreshMeta();
  }

  function refreshMeta() {
    if (!metaOpen) return;
    const doc = (lastMemory && lastMemory.doc) || {};
    renderMeta(doc);
  }

  function ensureEcharts() {
    if (window.echarts) return Promise.resolve(window.echarts);
    if (echartsPromise) return echartsPromise;
    echartsPromise = new Promise(function (resolve, reject) {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js";
      script.onload = function () {
        if (window.echarts) resolve(window.echarts);
        else reject(new Error("echarts missing"));
      };
      script.onerror = function () { reject(new Error("echarts failed")); };
      document.head.appendChild(script);
    });
    return echartsPromise;
  }

  function topicForKeyword(term, topics) {
    const parts = String(term || "").toLowerCase().split(/\s+/);
    let best = "";
    let score = 0;
    (topics || []).forEach(function (topic) {
      const raw = String(topic || "").toLowerCase();
      const tp = raw.split(/\s+/);
      let s = 0;
      parts.forEach(function (part) {
        if (!part) return;
        if (tp.indexOf(part) !== -1) s += 2;
        else if (raw.indexOf(part) !== -1) s += 1;
      });
      if (s > score) {
        score = s;
        best = String(topic);
      }
    });
    return score ? best : "";
  }

  function bindCloudWord(btn) {
    btn.style.setProperty("--kw", btn.style.color || keywordColor(btn.getAttribute("data-term")));
    btn.addEventListener("click", function () {
      if (btn.getAttribute("data-kind") === "idea") selectIdea(btn.getAttribute("data-idea") || "");
      else selectKeyword(btn.getAttribute("data-term") || "");
    });
  }

  const CLOUD_STOP = {
    the: 1, and: 1, for: 1, that: 1, with: 1, this: 1, from: 1, have: 1, were: 1,
    been: 1, they: 1, their: 1, what: 1, when: 1, where: 1, which: 1, will: 1,
    your: 1, about: 1, into: 1, than: 1, then: 1, them: 1, these: 1, those: 1,
    there: 1, here: 1, also: 1, just: 1, only: 1, more: 1, some: 1, such: 1,
    other: 1, over: 1, after: 1, before: 1, because: 1, while: 1, would: 1,
    could: 1, should: 1, each: 1, very: 1, much: 1, many: 1, most: 1, same: 1,
    within: 1, without: 1, between: 1, through: 1, note: 1, notes: 1,
  };

  function prepareCloudWords(doc) {
    const words = [];
    const seen = Object.create(null);
    (doc.keywords || []).forEach(function (pair) {
      if (!pair || !pair[0]) return;
      const term = String(pair[0]).trim();
      const key = term.toLowerCase();
      if (!term || seen[key]) return;
      seen[key] = true;
      words.push([term, Number(pair[1]) || 1]);
    });
    words.sort(function (a, b) { return b[1] - a[1]; });
    const maxWeight = words.length ? words[0][1] : 1;
    if (words.length && words.length < 12) {
      cloudFillers(words, maxWeight).forEach(function (pair) {
        const key = String(pair[0]).toLowerCase();
        if (seen[key]) return;
        seen[key] = true;
        words.push(pair);
      });
      words.sort(function (a, b) { return b[1] - a[1]; });
    }
    return words.slice(0, 26);
  }

  function cloudFillers(existing, maxWeight) {
    if (!article) return [];
    const used = Object.create(null);
    existing.forEach(function (pair) {
      String(pair[0] || "").toLowerCase().split(/\s+/).forEach(function (part) {
        if (part) used[part] = true;
      });
    });
    const counts = Object.create(null);
    String(article.innerText || "").toLowerCase().split(/[^a-z0-9]+/).forEach(function (tok) {
      if (tok.length < 4 || CLOUD_STOP[tok] || used[tok]) return;
      counts[tok] = (counts[tok] || 0) + 1;
    });
    const ranked = Object.keys(counts).filter(function (tok) { return counts[tok] >= 3; });
    ranked.sort(function (a, b) { return counts[b] - counts[a]; });
    const top = ranked.length ? counts[ranked[0]] : 1;
    const cap = Math.max(1, maxWeight * 0.5);
    return ranked.slice(0, 14).map(function (tok) {
      return [tok, Math.max(1, Math.round((counts[tok] / top) * cap))];
    });
  }

  function cloudUpright(term, index) {
    if (index === 0) return false;
    const text = String(term || "");
    if (text.length > 14 || text.split(/\s+/).length > 2) return false;
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (h * 33 + text.charCodeAt(i)) >>> 0;
    return (h % 3) === 0;
  }

  function cloudFontPx(count, max, bigPx) {
    const t = Math.pow((Number(count) || 1) / (max || 1), 0.62);
    return Math.round(13 + t * bigPx);
  }

  function shrinkCloudWord(btn, limit) {
    let size = parseFloat(btn.style.fontSize) || 16;
    let guard = 0;
    while (btn.offsetWidth > limit && size > 13 && guard < 10) {
      size = Math.max(13, size * 0.86);
      btn.style.fontSize = Math.round(size) + "px";
      guard += 1;
    }
  }

  function cloudSpot(box, placed, width, height) {
    const cx = width / 2;
    const cy = height / 2;
    const pad = 2;
    for (let t = 0; t < 780; t++) {
      const ang = t * 0.45;
      const rad = t / 780;
      const x = cx + Math.cos(ang) * rad * (width * 0.48) - box.w / 2;
      const y = cy + Math.sin(ang) * rad * (height * 0.46) - box.h / 2;
      if (x < 1 || y < 1 || x + box.w > width - 1 || y + box.h > height - 1) continue;
      const hit = placed.some(function (p) {
        return x < p.x + p.w + pad && x + box.w + pad > p.x && y < p.y + p.h + pad && y + box.h + pad > p.y;
      });
      if (!hit) return { x: x, y: y };
    }
    return null;
  }

  function cloudCoverage(packed) {
    const placed = packed.placed;
    if (!placed.length) return 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = 0;
    let maxY = 0;
    placed.forEach(function (p) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + p.w);
      maxY = Math.max(maxY, p.y + p.h);
    });
    return Math.min((maxX - minX) / packed.width, (maxY - minY) / packed.height);
  }

  function packCloud(host, words, scale) {
    host.innerHTML = "";
    const width = host.clientWidth || 480;
    const height = host.clientHeight || 288;
    const max = words.reduce(function (m, pair) { return Math.max(m, Number(pair[1]) || 1); }, 1);
    const bigPx = Math.min(68 * scale, Math.min(width, height) * 0.26 * scale);
    const placed = [];
    let skipped = 0;
    words.forEach(function (pair, i) {
      const btn = cloudButton(pair, max, bigPx);
      const upright = cloudUpright(pair[0], i);
      if (upright) btn.classList.add("is-up");
      host.appendChild(btn);
      shrinkCloudWord(btn, upright ? height * 0.72 : width * 0.9);
      function measure() {
        const bw = btn.offsetWidth;
        const bh = btn.offsetHeight;
        const turned = btn.classList.contains("is-up");
        return {
          bw: bw,
          bh: bh,
          box: turned ? { w: bh, h: bw } : { w: bw, h: bh },
        };
      }
      let measured = measure();
      let spot = null;
      if (i === 0) {
        spot = {
          x: Math.max(2, Math.min((width - measured.box.w) / 2, width - measured.box.w - 2)),
          y: Math.max(2, Math.min((height - measured.box.h) / 2, height - measured.box.h - 2)),
        };
      } else {
        spot = cloudSpot(measured.box, placed, width, height);
        let size = parseFloat(btn.style.fontSize) || 16;
        let guard = 0;
        while (!spot && size > 15 && guard < 6) {
          size = Math.max(15, size * 0.8);
          btn.style.fontSize = Math.round(size) + "px";
          measured = measure();
          spot = cloudSpot(measured.box, placed, width, height);
          guard += 1;
        }
        if (!spot && !btn.classList.contains("is-up") && String(pair[0]).length <= 16) {
          btn.classList.add("is-up");
          measured = measure();
          spot = cloudSpot(measured.box, placed, width, height);
        }
      }
      if (!spot) {
        btn.remove();
        skipped += 1;
        return;
      }
      const left = btn.classList.contains("is-up") ? spot.x + measured.box.w / 2 - measured.bw / 2 : spot.x;
      const top = btn.classList.contains("is-up") ? spot.y + measured.box.h / 2 - measured.bh / 2 : spot.y;
      btn.style.left = Math.round(left) + "px";
      btn.style.top = Math.round(top) + "px";
      placed.push({ x: spot.x, y: spot.y, w: measured.box.w, h: measured.box.h });
    });
    return { placed: placed, skipped: skipped, width: width, height: height };
  }

  function ideaCloudRows() {
    const rows = [];
    const seen = Object.create(null);
    (metaIdeas || []).forEach(function (idea) {
      const only = idea.keywords.length === 1 && idea.keywords[0].term.toLowerCase() === idea.name.toLowerCase();
      if (!only && !seen[idea.name.toLowerCase()]) {
        seen[idea.name.toLowerCase()] = true;
        const row = [idea.name, Math.max(idea.weight, 1)];
        row.kind = "idea";
        row.idea = idea.name;
        row.term = idea.name;
        row.color = idea.color;
        rows.push(row);
      }
      idea.keywords.forEach(function (kw) {
        const key = kw.term.toLowerCase();
        if (seen[key]) return;
        seen[key] = true;
        const row = [kw.term, kw.count];
        row.kind = "keyword";
        row.idea = idea.name;
        row.term = kw.term;
        row.color = idea.color;
        rows.push(row);
      });
    });
    rows.sort(function (a, b) { return b[1] - a[1]; });
    if (rows.length && rows.length < 12) {
      cloudFillers(rows, rows[0][1]).forEach(function (pair) {
        const key = String(pair[0]).toLowerCase();
        if (seen[key]) return;
        seen[key] = true;
        const row = [pair[0], pair[1]];
        row.kind = "keyword";
        row.idea = pair[0];
        row.term = pair[0];
        row.color = keywordColor(pair[0]);
        rows.push(row);
      });
      rows.sort(function (a, b) { return b[1] - a[1]; });
    }
    return rows.slice(0, 26);
  }

  function renderCloud(doc) {
    const host = document.getElementById("memory-cloud");
    const title = document.getElementById("memory-cloud-title");
    if (!host) return;
    if (title) title.textContent = "Word cloud";
    host.classList.remove("is-grouped");
    const words = metaIdeas && metaIdeas.length ? ideaCloudRows() : prepareCloudWords(doc || {});
    if (!words.length) {
      host.removeAttribute("data-packed");
      host.innerHTML = '<p class="memory-empty">No repeated phrases in this note.</p>';
      return;
    }
    const first = packCloud(host, words, 1);
    const fill = cloudCoverage(first);
    if (fill < 0.68 && first.skipped < words.length * 0.4) {
      const again = packCloud(host, words, 1.24);
      const better = cloudCoverage(again) > fill && again.placed.length + 1 >= first.placed.length;
      if (!better) packCloud(host, words, 1);
    }
    host.setAttribute("data-packed", "1");
    syncCloudFocus();
  }

  function cloudButton(pair, max, bigPx) {
    const term = String(pair[0]);
    const n = Number(pair[1]) || 1;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cloud-word";
    btn.setAttribute("data-term", pair.term || term);
    btn.setAttribute("data-idea", pair.idea || term);
    btn.setAttribute("data-kind", pair.kind || "keyword");
    btn.textContent = pair.kind === "idea" ? "(" + term + ")" : term;
    btn.style.color = pair.color || keywordColor(term);
    btn.style.fontSize = cloudFontPx(n, max, bigPx) + "px";
    btn.style.fontWeight = pair.kind === "idea" || n / max > 0.45 ? "700" : "600";
    bindCloudWord(btn);
    return btn;
  }

  function headingTitle(heading) {
    const clone = heading.cloneNode(true);
    clone.querySelectorAll(".h-anchor").forEach(function (el) { el.remove(); });
    return String(clone.textContent || "").replace(/\s+/g, " ").trim();
  }

  function headingLevel(heading) {
    return Number(String(heading.tagName || "").replace(/\D/g, "")) || 6;
  }

  function sectionSlice(heading, nested) {
    const stopLevel = nested ? headingLevel(heading) : 6;
    const parts = [];
    let words = 0;
    let node = heading.nextElementSibling;
    while (node) {
      if (/^H[1-6]$/.test(node.tagName) && headingLevel(node) <= stopLevel) break;
      if (!node.classList || !node.classList.contains("toc")) {
        const chunk = String(node.innerText || "").replace(/\s+/g, " ").trim();
        if (chunk) {
          parts.push(chunk);
          words += chunk.split(" ").length;
        }
      }
      node = node.nextElementSibling;
    }
    return { words: words, text: parts.join("\n") };
  }

  function countTerm(text, term) {
    const re = keywordPattern(term);
    if (!re || !text) return 0;
    const found = String(text).match(re);
    return found ? found.length : 0;
  }

  function sectionPhraseHits(text) {
    const hits = [];
    (metaIdeas || []).forEach(function (idea) {
      let total = 0;
      const terms = [];
      idea.keywords.forEach(function (kw) {
        const n = countTerm(text, kw.term);
        if (!n) return;
        total += n;
        terms.push({ term: kw.term, count: n });
      });
      const named = idea.keywords.some(function (kw) {
        return kw.term.toLowerCase() === idea.name.toLowerCase();
      });
      if (!named) {
        const n = countTerm(text, idea.name);
        if (n) {
          total += n;
          terms.push({ term: idea.name, count: n });
        }
      }
      if (!total) return;
      hits.push({ name: idea.name, color: idea.color, count: total, terms: terms });
    });
    hits.sort(function (a, b) { return b.count - a.count; });
    return hits;
  }

  function sectionHitLabel(hit) {
    const only = hit.terms.length === 1 && hit.terms[0].term.toLowerCase() === hit.name.toLowerCase();
    return (only ? hit.name : "(" + hit.name + ")") + " · " + hit.count;
  }

  let sectionTipTimer = 0;

  function sectionTipEl() {
    let tip = document.getElementById("section-tip");
    if (tip) return tip;
    tip = document.createElement("div");
    tip.id = "section-tip";
    tip.className = "section-tip";
    tip.hidden = true;
    tip.addEventListener("mouseenter", function () { clearTimeout(sectionTipTimer); });
    tip.addEventListener("mouseleave", scheduleHideSectionTip);
    document.body.appendChild(tip);
    return tip;
  }

  function hideSectionTip() {
    clearTimeout(sectionTipTimer);
    const tip = document.getElementById("section-tip");
    if (tip) tip.hidden = true;
  }

  function scheduleHideSectionTip() {
    clearTimeout(sectionTipTimer);
    sectionTipTimer = setTimeout(hideSectionTip, 160);
  }

  function showSectionTip(block, title, words, hits) {
    const tip = sectionTipEl();
    clearTimeout(sectionTipTimer);
    const lines = ['<p class="section-tip-title">' + escapeHtml(title) + "</p>"];
    lines.push('<p class="section-tip-count">' + words + (words === 1 ? " word" : " words") + "</p>");
    if (!hits.length) {
      lines.push('<p class="section-tip-empty">No tracked phrases in this section.</p>');
    } else {
      hits.slice(0, 8).forEach(function (hit) {
        lines.push(
          '<p class="section-tip-hit" style="--kw:' + hit.color + '">' + escapeHtml(sectionHitLabel(hit)) + "</p>"
        );
        if (hit.terms.length > 1 || hit.terms[0].term.toLowerCase() !== hit.name.toLowerCase()) {
          hit.terms.slice(0, 4).forEach(function (term) {
            if (term.term.toLowerCase() === hit.name.toLowerCase()) return;
            lines.push(
              '<p class="section-tip-term">' + escapeHtml(term.term) + " · " + term.count + "</p>"
            );
          });
        }
      });
    }
    tip.innerHTML = lines.join("");
    tip.hidden = false;
    const rect = block.getBoundingClientRect();
    const width = tip.offsetWidth;
    const height = tip.offsetHeight;
    let left = rect.left;
    let top = rect.top - height - 8;
    if (top < 8) top = rect.bottom + 8;
    if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
    tip.style.left = Math.max(8, left) + "px";
    tip.style.top = top + "px";
  }

  function syncSectionFocus() {
    const host = document.getElementById("memory-sections");
    if (!host) return;
    host.querySelectorAll(".section-block").forEach(function (el) {
      const ideas = (el.getAttribute("data-ideas") || "").split("|").filter(Boolean);
      const terms = (el.getAttribute("data-terms") || "").split("|").filter(Boolean);
      let lit = !metaFocus;
      if (metaFocus && metaFocus.kind === "idea") {
        lit = ideas.indexOf(String(metaFocus.name || "").toLowerCase()) !== -1;
      } else if (metaFocus && metaFocus.kind === "keyword") {
        const term = String(metaFocus.term || "").toLowerCase();
        const idea = String(metaFocus.idea || "").toLowerCase();
        lit = terms.indexOf(term) !== -1 || (idea && ideas.indexOf(idea) !== -1);
      }
      el.classList.toggle("is-dim", !!metaFocus && !lit);
      el.classList.toggle("is-on", !!metaFocus && lit);
    });
  }

  function renderSections(doc) {
    const host = document.getElementById("memory-sections");
    if (!host) return;
    hideSectionTip();
    host.innerHTML = "";
    const heads = article ? article.querySelectorAll("h1, h2, h3") : [];
    if (!heads.length) {
      host.innerHTML = '<p class="memory-empty">No headings in this note.</p>';
      return;
    }
    const hot = aiEnabled() && doc.rich
      ? [doc.important || "", doc.next_action || ""].concat(doc.tldr || []).join(" ").toLowerCase()
      : "";
    const blocks = [];
    Array.prototype.forEach.call(heads, function (heading, i) {
      const title = headingTitle(heading);
      const direct = sectionSlice(heading, false);
      const nested = direct.words ? direct : sectionSlice(heading, true);
      const hits = sectionPhraseHits(title + "\n" + nested.text);
      blocks.push({ heading: heading, title: title, words: nested.words, hits: hits });
    });
    const max = blocks.reduce(function (m, block) { return Math.max(m, block.words); }, 1);
    blocks.forEach(function (block) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "section-block";
      const title = block.title || "Section";
      const tokens = title.toLowerCase().split(/\s+/).filter(function (part) { return part.length > 3; });
      if (hot && tokens.some(function (part) { return hot.indexOf(part) !== -1; })) {
        btn.classList.add("is-hot");
      }
      const ideaNames = [];
      const termNames = [];
      block.hits.forEach(function (hit) {
        ideaNames.push(hit.name.toLowerCase());
        hit.terms.forEach(function (term) { termNames.push(term.term.toLowerCase()); });
      });
      btn.setAttribute("data-ideas", ideaNames.join("|"));
      btn.setAttribute("data-terms", termNames.join("|"));
      btn.setAttribute("aria-label", title + ", " + block.words + (block.words === 1 ? " word" : " words"));
      const bar = document.createElement("span");
      bar.className = "section-bar";
      const scale = max ? block.words / max : 0;
      bar.style.height = Math.round(18 + scale * 78) + "px";
      if (block.hits.length) {
        bar.style.background = block.hits[0].color;
      }
      const count = document.createElement("span");
      count.className = "section-count";
      count.textContent = String(block.words);
      bar.appendChild(count);
      const label = document.createElement("span");
      label.className = "section-label";
      label.textContent = title;
      btn.appendChild(bar);
      btn.appendChild(label);
      if (block.hits.length) {
        const pick = document.createElement("span");
        pick.className = "section-pick";
        pick.style.setProperty("--kw", block.hits[0].color);
        pick.textContent = sectionHitLabel(block.hits[0]);
        pick.addEventListener("click", function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          const hit = block.hits[0];
          const only = hit.terms.length === 1 && hit.terms[0].term.toLowerCase() === hit.name.toLowerCase();
          if (only) selectKeyword(hit.terms[0].term);
          else selectIdea(hit.name);
        });
        btn.appendChild(pick);
      }
      btn.addEventListener("mouseenter", function () {
        showSectionTip(btn, title, block.words, block.hits);
      });
      btn.addEventListener("mouseleave", scheduleHideSectionTip);
      btn.addEventListener("focus", function () {
        showSectionTip(btn, title, block.words, block.hits);
      });
      btn.addEventListener("blur", scheduleHideSectionTip);
      btn.addEventListener("click", function () {
        hideSectionTip();
        if (block.heading.id) scrollToHash(block.heading.id);
        else block.heading.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      host.appendChild(btn);
    });
    syncSectionFocus();
  }

  function graphNode(id, label, size, color, extra) {
    const node = {
      id: id,
      name: shortLabel(label, 22),
      symbolSize: size,
      itemStyle: { color: color },
    };
    if (extra) {
      Object.keys(extra).forEach(function (key) { node[key] = extra[key]; });
    }
    return node;
  }

  function freqSize(count, max, lo, hi) {
    const t = Math.sqrt((Number(count) || 1) / (Number(max) || 1));
    return Math.round(lo + Math.max(0, Math.min(1, t)) * (hi - lo));
  }

  function clampNum(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function labelSide(x, y, width, height) {
    if (x < 120) return "right";
    if (x > width - 120) return "left";
    if (y < 32) return "bottom";
    if (y > height - 32) return "top";
    return x < width / 2 ? "left" : "right";
  }

  function graphEdge(source, target, dashed, color) {
    const line = {
      curveness: 0.3,
      width: dashed ? 1.2 : 1.55,
      type: dashed ? "dashed" : "solid",
      opacity: 0.92,
    };
    if (color) line.color = color;
    return { source: source, target: target, lineStyle: line };
  }

  const LINK_HEXAGON = "path://M50,0 L93.3,25 L93.3,75 L50,100 L6.7,75 L6.7,25 Z";

  function categoryLabel(name) {
    return "(" + shortLabel(name, 20) + ")";
  }

  function linkFill(hex) {
    const n = parseInt(String(hex || "").replace("#", ""), 16);
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + ",0.28)";
  }

  function linkVisual(kind) {
    if (kind === "ext") return { symbol: LINK_HEXAGON, border: "#93a3b5" };
    if (kind === "file") return { symbol: "circle", border: "#3dbe9a" };
    return { symbol: "circle", border: "#00b4e6" };
  }

  function styleLinkNode(node, kind) {
    const visual = linkVisual(kind);
    node.symbol = visual.symbol;
    node.itemStyle = {
      color: linkFill(visual.border),
      borderColor: visual.border,
      borderWidth: 3.5,
    };
    return visual;
  }

  function collectPageLinks() {
    const out = [];
    const seen = Object.create(null);
    if (!article) return out;
    article.querySelectorAll("a.link-file, a.link-ext").forEach(function (a) {
      if (a.classList.contains("link-file")) {
        const href = a.getAttribute("href") || "";
        const path = decodeURIComponent(href.replace(/^\//, "").split("#")[0].split("?")[0]);
        if (!path || seen["file:" + path]) return;
        seen["file:" + path] = true;
        const label = String(a.textContent || "").replace(/\s+\S+$/, "").trim() || path.split("/").pop();
        out.push({
          kind: "file",
          path: path,
          url: href,
          file: fileKind(path),
          label: label,
        });
        return;
      }
      const url = a.href || "";
      if (!url || seen["ext:" + url]) return;
      seen["ext:" + url] = true;
      let host = url;
      let label = url;
      try {
        const parsed = new URL(url);
        host = parsed.hostname.replace(/^www\./, "");
        const tail = parsed.pathname.replace(/\/$/, "").split("/").filter(Boolean).pop() || "";
        label = tail ? host + "/" + tail : host;
      } catch (err) {
        host = url;
        label = url;
      }
      out.push({ kind: "ext", url: url, host: host, label: label });
    });
    return out;
  }

  function folderPathsFor(term) {
    const topics = (lastMemory && lastMemory.topics) || {};
    const want = String(term || "").trim().toLowerCase();
    if (!want) return [];
    const found = [];
    Object.keys(topics).forEach(function (key) {
      if (String(key).trim().toLowerCase() !== want) return;
      (topics[key] || []).forEach(function (path) { found.push(String(path || "")); });
    });
    const seen = Object.create(null);
    const out = [];
    found.forEach(function (path) {
      if (!path || path === currentPath || seen[path] || !findNote(path)) return;
      seen[path] = true;
      out.push(path);
    });
    return out.slice(0, 4);
  }

  function collectIdeas(doc) {
    const rich = !!(aiEnabled() && doc && doc.rich);
    const aiTopics = rich
      ? (doc.topics || []).map(function (t) { return String(t || "").trim(); }).filter(Boolean)
      : [];
    const pairs = ((doc && doc.keywords) || []).filter(function (pair) { return pair && pair[0]; }).slice(0, 16);
    const buckets = Object.create(null);
    const order = [];
    function add(name, pair) {
      const key = String(name || "").trim().toLowerCase();
      if (!key) return;
      if (!buckets[key]) {
        buckets[key] = { name: String(name).trim(), keywords: [] };
        order.push(key);
      }
      if (!pair) return;
      const term = String(pair[0]).trim();
      if (!term) return;
      const dup = buckets[key].keywords.some(function (kw) { return kw.term.toLowerCase() === term.toLowerCase(); });
      if (!dup) buckets[key].keywords.push({ term: term, count: Number(pair[1]) || 1 });
    }
    if (aiTopics.length) {
      pairs.forEach(function (pair) {
        const topic = topicForKeyword(pair[0], aiTopics);
        if (topic && topic.toLowerCase() !== "other") add(topic, pair);
        else add(pair[0], pair);
      });
    } else {
      pairs.forEach(function (pair) { add(pair[0], pair); });
    }
    return order.map(function (key) {
      const bucket = buckets[key];
      const weight = bucket.keywords.reduce(function (sum, kw) { return sum + kw.count; }, 0) || 1;
      const notes = [];
      const seen = Object.create(null);
      bucket.keywords.forEach(function (kw) {
        folderPathsFor(kw.term).forEach(function (path) {
          if (seen[path] || notes.length >= 4) return;
          seen[path] = true;
          notes.push({ path: path, via: kw.term });
        });
      });
      return {
        name: bucket.name,
        color: keywordColor(bucket.name),
        weight: weight,
        keywords: bucket.keywords,
        notes: notes,
      };
    }).sort(function (a, b) { return b.weight - a.weight; }).slice(0, 10);
  }

  function findMetaIdea(name) {
    const key = String(name || "").toLowerCase();
    for (let i = 0; i < metaIdeas.length; i++) {
      if (metaIdeas[i].name.toLowerCase() === key) return metaIdeas[i];
    }
    return null;
  }

  function ideaNameFor(term) {
    const key = String(term || "").toLowerCase();
    for (let i = 0; i < metaIdeas.length; i++) {
      const idea = metaIdeas[i];
      if (idea.name.toLowerCase() === key) return idea.name;
      for (let k = 0; k < idea.keywords.length; k++) {
        if (idea.keywords[k].term.toLowerCase() === key) return idea.name;
      }
    }
    return "";
  }

  function reconcileFocus(ideas) {
    if (!metaFocus) return;
    const name = String(metaFocus.kind === "idea" ? metaFocus.name : metaFocus.term || "").toLowerCase();
    const found = (ideas || []).some(function (idea) {
      if (idea.name.toLowerCase() === name) return true;
      return idea.keywords.some(function (kw) { return kw.term.toLowerCase() === name; });
    });
    if (!found) metaFocus = null;
  }

  function syncKeywordChips() {
    document.querySelectorAll("#memory-keys [data-keyword]").forEach(function (btn) {
      const term = btn.getAttribute("data-keyword") || "";
      btn.setAttribute("aria-pressed", keywordIsOn(term) ? "true" : "false");
    });
  }

  function syncCloudFocus() {
    const cloud = document.getElementById("memory-cloud");
    if (!cloud) return;
    cloud.querySelectorAll(".cloud-word").forEach(function (el) {
      const kind = el.getAttribute("data-kind") || "keyword";
      const idea = (el.getAttribute("data-idea") || "").toLowerCase();
      const term = (el.getAttribute("data-term") || "").toLowerCase();
      let lit = !metaFocus;
      if (metaFocus && metaFocus.kind === "idea") lit = idea === String(metaFocus.name || "").toLowerCase();
      else if (metaFocus && metaFocus.kind === "keyword") {
        lit = term === String(metaFocus.term || "").toLowerCase() || (kind === "idea" && idea === String(metaFocus.idea || "").toLowerCase());
      }
      el.classList.toggle("is-dim", !!metaFocus && !lit);
      el.classList.toggle("is-on", !!metaFocus && lit);
    });
  }

  function clearFocusMarks() {
    clearKeywordHighlights();
    activeKeywords = [];
    syncKeywordChips();
  }

  function reapplyFocusMarks() {
    if (!metaFocus) return;
    clearKeywordHighlights();
    activeKeywords = [];
    if (metaFocus.kind === "keyword") setKeywordActive(metaFocus.term, true);
    else if (metaFocus.kind === "idea") {
      const idea = findMetaIdea(metaFocus.name);
      (idea ? idea.keywords : []).forEach(function (kw) { setKeywordActive(kw.term, true); });
    }
    syncKeywordChips();
  }

  function focusSeedId() {
    if (!metaFocus) return "";
    if (metaFocus.kind === "keyword") {
      const term = String(metaFocus.term || "").toLowerCase();
      const idea = findMetaIdea(metaFocus.idea || ideaNameFor(term));
      if (idea && idea.name.toLowerCase() === term && !keywordOnly(idea)) return "idea:" + term;
      return "kw:" + term;
    }
    const idea = findMetaIdea(metaFocus.name);
    if (!idea) return "";
    const only = idea.keywords.length === 1 && idea.keywords[0].term.toLowerCase() === idea.name.toLowerCase();
    if (only) return "kw:" + idea.keywords[0].term.toLowerCase();
    return "idea:" + idea.name.toLowerCase();
  }

  function paintGraphFocus() {
    syncCloudFocus();
    syncSectionFocus();
    if (!metaChart || !metaGraphModel) return;
    metaChart.dispatchAction({ type: "downplay", seriesIndex: 0 });
    const seed = focusSeedId();
    if (!seed) return;
    const index = metaGraphModel.nodes.findIndex(function (node) { return node.id === seed; });
    if (index < 0) return;
    metaChart.dispatchAction({ type: "highlight", seriesIndex: 0, dataIndex: index });
  }

  function selectIdea(name) {
    const clean = String(name || "").trim();
    if (!clean) return;
    if (metaFocus && metaFocus.kind === "idea" && metaFocus.name.toLowerCase() === clean.toLowerCase()) {
      metaFocus = null;
      clearFocusMarks();
      paintGraphFocus();
      return;
    }
    metaFocus = { kind: "idea", name: clean };
    reapplyFocusMarks();
    paintGraphFocus();
  }

  function selectKeyword(term) {
    const clean = String(term || "").trim();
    if (!clean) return;
    if (metaFocus && metaFocus.kind === "keyword" && metaFocus.term.toLowerCase() === clean.toLowerCase()) {
      metaFocus = null;
      clearFocusMarks();
      paintGraphFocus();
      return;
    }
    metaFocus = { kind: "keyword", term: clean, idea: ideaNameFor(clean) };
    reapplyFocusMarks();
    paintGraphFocus();
  }

  function zoomGraph(factor) {
    if (!metaChart) return;
    const host = document.getElementById("memory-graph");
    metaChart.dispatchAction({
      type: "graphRoam",
      seriesIndex: 0,
      zoom: factor,
      originX: host ? host.clientWidth / 2 : 200,
      originY: host ? host.clientHeight / 2 : 140,
    });
  }

  function homeGraph() {
    metaFocus = null;
    clearFocusMarks();
    syncCloudFocus();
    syncSectionFocus();
    paintGraph((lastMemory && lastMemory.doc) || {});
  }

  function setMetaWide(on) {
    metaWide = !!on;
    const panel = document.getElementById("memory-meta");
    if (panel) panel.classList.toggle("is-wide", metaWide);
    const btn = document.getElementById("memory-graph-expand");
    if (btn) {
      btn.setAttribute("aria-pressed", metaWide ? "true" : "false");
      btn.textContent = metaWide ? "Shrink" : "Enlarge";
    }
    requestAnimationFrame(function () {
      requestAnimationFrame(refreshMeta);
    });
  }

  function atRing(ang, ring, width, height) {
    return {
      x: clampNum(width / 2 + Math.cos(ang) * ((width / 2) * ring), 36, width - 36),
      y: clampNum(height / 2 + Math.sin(ang) * ((height / 2) * ring), 28, height - 28),
    };
  }

  function keywordOnly(idea) {
    return idea.keywords.length === 1 && idea.keywords[0].term.toLowerCase() === idea.name.toLowerCase();
  }

  function separateNodes(nodes, width, height) {
    for (let pass = 0; pass < 6; pass++) {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
          const hubGap = (a.id === "me" || b.id === "me") ? 28 : 0;
          const need = (a.symbolSize + b.symbolSize) / 2 + 8 + hubGap;
          if (dist >= need) continue;
          const push = (need - dist) / 2;
          dx /= dist;
          dy /= dist;
          if (a.id !== "me") {
            a.x -= dx * push;
            a.y -= dy * push;
          }
          if (b.id !== "me") {
            b.x += dx * push;
            b.y += dy * push;
          }
        }
      }
    }
    nodes.forEach(function (node) {
      if (node.id === "me") return;
      const padX = node.symbolSize / 2 + 16;
      const padY = node.symbolSize / 2 + 12;
      node.x = clampNum(node.x, padX, width - padX);
      node.y = clampNum(node.y, padY, height - padY);
    });
  }

  function buildGraphModel(doc, width, height) {
    const ideas = metaIdeas.length ? metaIdeas : collectIdeas(doc || {});
    const nodes = [];
    const links = [];
    const used = Object.create(null);
    const cx = width / 2;
    const cy = height / 2;
    const title = (doc && (doc.title || currentPath)) || "This note";
    const me = graphNode("me", shortLabel(title, 18), 16, "#14202c", { kind: "me" });
    me.x = cx;
    me.y = ideas.length === 1 ? height - 34 : cy;
    me.label = { show: false };
    nodes.push(me);

    const maxW = ideas.reduce(function (m, idea) { return Math.max(m, idea.weight); }, 1);
    const count = Math.max(ideas.length, 1);
    ideas.forEach(function (idea, i) {
      const ang = -Math.PI / 2 + (i / count) * Math.PI * 2;
      const only = keywordOnly(idea);
      const hubRing = ideas.length === 1 ? 0 : 0.28;
      const hubPos = ideas.length === 1 ? { x: cx, y: cy } : atRing(ang, hubRing, width, height);
      let hubId = "";
      if (only) {
        const kw = idea.keywords[0];
        hubId = "kw:" + kw.term.toLowerCase();
        nodes.push(graphNode(hubId, kw.term, freqSize(kw.count, maxW, 22, 58), idea.color, {
          kind: "keyword",
          term: kw.term,
          idea: idea.name,
          x: hubPos.x,
          y: hubPos.y,
        }));
      } else {
        hubId = "idea:" + idea.name.toLowerCase();
        const ideaNode = graphNode(hubId, categoryLabel(idea.name), freqSize(idea.weight, maxW, 28, 60), idea.color, {
          kind: "idea",
          idea: idea.name,
          x: hubPos.x,
          y: hubPos.y,
          itemStyle: { color: idea.color, borderColor: "#14202c", borderWidth: 1.5 },
        });
        ideaNode.name = categoryLabel(idea.name);
        nodes.push(ideaNode);
        const orbit = idea.keywords.filter(function (kw) {
          return kw.term.toLowerCase() !== idea.name.toLowerCase();
        });
        orbit.forEach(function (kw, k) {
          const span = Math.min(1.15, 0.42 * Math.max(orbit.length, 1));
          const kAng = ang - span / 2 + (k + 0.5) * (span / orbit.length);
          const pos = atRing(kAng, 0.52, width, height);
          const id = "kw:" + kw.term.toLowerCase();
          nodes.push(graphNode(id, kw.term, freqSize(kw.count, maxW, 16, 46), idea.color, {
            kind: "keyword",
            term: kw.term,
            idea: idea.name,
            x: pos.x,
            y: pos.y,
          }));
          links.push(graphEdge(id, hubId, false, idea.color));
        });
      }
      links.push(graphEdge(hubId, "me", true, idea.color));
      idea.notes.forEach(function (note, j) {
        if (used[note.path]) return;
        used[note.path] = true;
        const span = Math.min(1.05, 0.38 * Math.max(idea.notes.length, 1));
        const t = idea.notes.length === 1 ? 0 : (j / (idea.notes.length - 1)) - 0.5;
        const pos = atRing(ang + t * span, 0.84, width, height);
        const id = "note:" + note.path;
        const found = findNote(note.path);
        const viaSame = String(note.via || "").toLowerCase() === idea.name.toLowerCase();
        const kwId = "kw:" + String(note.via || "").toLowerCase();
        const node = graphNode(id, (found && found.title) || note.path, 22, "transparent", {
          kind: "note",
          path: note.path,
          idea: idea.name,
          x: pos.x,
          y: pos.y,
        });
        styleLinkNode(node, "note");
        nodes.push(node);
        links.push(graphEdge(id, hubId, false, idea.color));
        if (!only && !viaSame) links.push(graphEdge(id, kwId, false, idea.color));
      });
    });

    const extras = [];
    (doc.links || []).forEach(function (path) {
      if (!path || path === currentPath || used[path] || !findNote(path)) return;
      extras.push({ kind: "note", path: path, dashed: false });
    });
    const hasNotes = nodes.some(function (node) { return node.kind === "note"; });
    if (!hasNotes) {
      const linked = Object.create(null);
      (doc.links || []).forEach(function (path) { linked[path] = true; });
      (doc.related || []).forEach(function (path) {
        if (!path || path === currentPath || linked[path] || used[path] || !findNote(path)) return;
        extras.push({ kind: "note", path: path, dashed: true });
      });
    }
    const pageLinks = collectPageLinks();
    const extFirst = [];
    const fileNext = [];
    pageLinks.forEach(function (item) {
      const key = item.kind === "ext" ? item.url : item.path;
      if (!key || used[key]) return;
      if (item.kind === "ext") extFirst.push(item);
      else fileNext.push(item);
    });
    extFirst.concat(fileNext).concat(extras).slice(0, 8).forEach(function (item, i, list) {
      const key = item.url || item.path;
      if (!key || used[key]) return;
      used[key] = true;
      const ang = -Math.PI / 2 + ((i + 0.5) / Math.max(list.length, 1)) * Math.PI * 2;
      const pos = atRing(ang, 0.86, width, height);
      let id = "";
      let label = "";
      const extra = { kind: item.kind, x: pos.x, y: pos.y };
      if (item.kind === "ext") {
        id = "ext:" + item.url;
        label = item.label || item.host || item.url;
        extra.url = item.url;
      } else if (item.kind === "file") {
        id = "file:" + item.path;
        label = item.label || item.path;
        extra.path = item.path;
        extra.url = item.url;
        extra.file = item.file;
      } else {
        id = "note:" + item.path;
        const found = findNote(item.path);
        label = (found && found.title) || item.path;
        extra.path = item.path;
      }
      const node = graphNode(id, label, 22, "transparent", extra);
      const visual = styleLinkNode(node, item.kind);
      nodes.push(node);
      links.push(graphEdge(id, "me", !!item.dashed, visual.border));
    });

    separateNodes(nodes, width, height);
    nodes.forEach(function (node) {
      if (node.id === "me") node.label = { show: false };
      else node.label = { position: labelSide(node.x, node.y, width, height) };
    });
    return { nodes: nodes, links: links };
  }

  function paintGraph(doc) {
    const host = document.getElementById("memory-graph");
    if (!host) return;
    const gen = ++metaGraphGen;
    if (metaChart) {
      metaChart.dispose();
      metaChart = null;
    }
    metaGraphModel = null;
    const width = host.clientWidth || 480;
    const height = host.clientHeight || 288;
    const model = buildGraphModel(doc || {}, width, height);
    if (model.nodes.length < 2) {
      host.innerHTML = '<p class="memory-empty">No links or keywords in this note.</p>';
      return;
    }
    metaGraphModel = model;
    host.innerHTML = "";
    ensureEcharts().then(function (echarts) {
      if (gen !== metaGraphGen || !metaOpen || !host.isConnected) return;
      metaChart = echarts.init(host, null, { renderer: "canvas" });
      metaChart.setOption({
        animationDuration: 280,
        animationDurationUpdate: 280,
        tooltip: { show: false },
        series: [{
          type: "graph",
          layout: "none",
          roam: true,
          draggable: true,
          cursor: "pointer",
          label: {
            show: true,
            color: "#14202c",
            fontFamily: "Inter, sans-serif",
            fontSize: 11,
            fontWeight: 600,
          },
          labelLayout: { hideOverlap: true },
          lineStyle: { color: "source", curveness: 0.3, width: 1.5, opacity: 0.9 },
          emphasis: { focus: "adjacency", lineStyle: { width: 2.6 } },
          blur: {
            itemStyle: { opacity: 0.12 },
            lineStyle: { opacity: 0.05 },
            label: { opacity: 0.28 },
          },
          data: model.nodes,
          links: model.links,
        }],
      });
      metaChart.on("click", function (params) {
        const data = params && params.data;
        if (!data || params.dataType !== "node") return;
        if (data.kind === "idea") {
          selectIdea(data.idea || "");
          return;
        }
        if (data.kind === "keyword" && data.term) {
          selectKeyword(data.term);
          return;
        }
        if (data.kind === "me") {
          metaFocus = null;
          clearFocusMarks();
          paintGraphFocus();
          return;
        }
        if (data.kind === "note" && data.path) {
          loadDoc(data.path, "", false);
          return;
        }
        if (data.kind === "file" && data.url) {
          if (data.file === "image" || data.file === "video" || data.file === "pdf") {
            openLightbox({ type: data.file, src: data.url, alt: data.name || "" });
          }
          return;
        }
        if (data.kind === "ext" && data.url) window.open(data.url, "_blank", "noopener");
      });
      requestAnimationFrame(function () {
        if (!metaChart || gen !== metaGraphGen) return;
        metaChart.resize();
        paintGraphFocus();
      });
    }).catch(function () {
      if (gen !== metaGraphGen) return;
      host.innerHTML = '<p class="memory-empty">The link graph needs a network the first time.</p>';
    });
  }

  function renderMeta(doc) {
    const stats = document.getElementById("memory-meta-stats");
    const words = noteWordCount();
    const minutes = words ? Math.max(1, Math.round(words / 220)) : 0;
    const headings = article ? article.querySelectorAll("h1, h2, h3").length : (doc.headings || []).length;
    const notes = (doc.links || []).length;
    const sites = externalHosts().length;
    if (stats) {
      const bits = [
        words + " words",
        minutes ? minutes + " min" : "0 min",
        headings + (headings === 1 ? " heading" : " headings"),
        notes + (notes === 1 ? " note" : " notes"),
        sites + (sites === 1 ? " site" : " sites"),
      ];
      if (aiEnabled() && doc.rich) bits.push("AI themes");
      stats.textContent = bits.join(" · ");
    }
    metaIdeas = collectIdeas(doc || {});
    reconcileFocus(metaIdeas);
    if (metaFocus) reapplyFocusMarks();
    renderCloud(doc || {});
    renderSections(doc || {});
    paintGraph(doc || {});
  }

  function beginMemory() {
    const wrap = document.getElementById("memory");
    if (!wrap) return;
    wrap.hidden = false;
    stopCardStream();
    const on = aiEnabled();
    const cards = document.getElementById("memory-cards");
    if (cards) {
      cards.hidden = !on;
      if (on) {
        const cached = cachedCardPack(currentPath);
        if (cached) {
          fillCardsInstant(cached, null);
          streamedCardKey = currentPath + "\0" + String(cached.sha256 || "");
        } else {
          streamedCardKey = "";
          cards.setAttribute("aria-busy", "true");
          cards.innerHTML = waitingCardsHtml();
        }
      } else {
        cards.removeAttribute("aria-busy");
      }
    }
    const keys = document.getElementById("memory-keys");
    if (keys) {
      keys.innerHTML = '<span class="memory-label">Keywords</span><span class="memory-empty">Counting…</span>';
    }
    const relatedEl = document.getElementById("memory-related");
    if (relatedEl) relatedEl.innerHTML = "";
    renderMemoryActions();
    loadChat(currentPath);
  }

  function renderMemoryFromLast() {
    if (lastMemory) renderMemory(lastMemory);
    else renderMemoryActions();
  }

  function renderMemory(data) {
    const wrap = document.getElementById("memory");
    if (!wrap) return;
    const doc = data && data.doc;
    if (!doc) {
      wrap.hidden = true;
      return;
    }
    lastMemory = data;
    wrap.hidden = false;
    renderCards(doc, data);
    renderMemoryActions();
    const keys = document.getElementById("memory-keys");
    if (keys) {
      const chips = (doc.keywords || []).slice(0, 12).map(function (pair) {
        const term = pair && pair[0] ? String(pair[0]) : "";
        const n = pair && pair[1] ? pair[1] : "";
        if (!term) return "";
        const pressed = keywordIsOn(term);
        return '<button type="button" class="memory-chip" data-keyword="' + escapeHtml(term) +
          '" aria-pressed="' + (pressed ? "true" : "false") +
          '" style="--kw:' + keywordColor(term) + '">' +
          escapeHtml(term) + (n ? " · " + n : "") + "</button>";
      }).join("");
      keys.innerHTML = chips ? '<span class="memory-label">Keywords</span>' + chips : "";
    }
    const relatedEl = document.getElementById("memory-related");
    if (relatedEl) {
      const items = doc.related || [];
      relatedEl.innerHTML = items.length
        ? '<span class="memory-label">Explore</span>' + items.map(function (p) {
            const note = findNote(p);
            const label = note ? note.title : p;
            return '<button type="button" class="memory-chip" data-path="' + escapeHtml(p) + '">' + escapeHtml(label) + "</button>";
          }).join("")
        : "";
    }
    refreshMeta();
  }

  async function syncMemory(path) {
    const gen = ++memoryGen;
    try {
      const data = await postJSON("/api/memory/visit", { path: path });
      if (gen !== memoryGen || path !== currentPath) return;
      if (!data.ok) {
        hideMemory();
        return;
      }
      renderMemory(data);
      if (aiEnabled() && data.doc && !data.doc.rich) {
        const rich = await postJSON("/api/memory/enrich", { path: path });
        if (gen !== memoryGen || path !== currentPath) return;
        if (rich && rich.doc) renderMemory(rich);
      }
    } catch (err) {
      if (gen === memoryGen) hideMemory();
    }
  }

  function chatMarkdown(md, path) {
    const box = document.createElement("div");
    box.className = "chat-md";
    const extracted = extractMath(md || "");
    box.innerHTML = restoreMath(marked.parse(extracted.md || ""), extracted.slots);
    rewriteRelativeMedia(box, path || currentPath);
    decorateLinks(box, path || currentPath);
    enhanceMedia(box);
    wrapCode(box);
    return box;
  }

  function chatAsMarkdown(messages) {
    const parts = [];
    (messages || []).forEach(function (msg) {
      if (msg.role === "user") parts.push("**You:**\n\n" + String(msg.text || "").trim());
      if (msg.role === "assistant") parts.push("**Assistant:**\n\n" + String(msg.text || "").trim());
    });
    return parts.join("\n\n");
  }

  function syncAskToggle() {
    const askBox = document.getElementById("memory-ask");
    const askBtn = document.getElementById("memory-ask-toggle");
    if (!askBtn) return;
    const open = !!(askBox && !askBox.hidden);
    askBtn.textContent = open ? "Close" : "Ask…";
    askBtn.setAttribute("aria-expanded", open ? "true" : "false");
    askBtn.setAttribute("aria-label", open ? "Close chat" : "Ask about this note");
  }

  function setAskOpen(open) {
    const askBox = document.getElementById("memory-ask");
    if (askBox) askBox.hidden = !open;
    askClosed = !open;
    syncAskToggle();
  }

  function lucideSvg() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.75");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    return svg;
  }

  function pencilSvg() {
    const svg = lucideSvg();
    const p1 = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p1.setAttribute("d", "M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z");
    const p2 = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p2.setAttribute("d", "m15 5 4 4");
    svg.appendChild(p1);
    svg.appendChild(p2);
    return svg;
  }

  function regenerateSvg() {
    const svg = lucideSvg();
    const loop = document.createElementNS("http://www.w3.org/2000/svg", "path");
    loop.setAttribute("d", "M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8");
    const arrow = document.createElementNS("http://www.w3.org/2000/svg", "path");
    arrow.setAttribute("d", "M21 3v5h-5");
    svg.appendChild(loop);
    svg.appendChild(arrow);
    return svg;
  }

  function copySvg() {
    const svg = lucideSvg();
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("width", "13");
    rect.setAttribute("height", "13");
    rect.setAttribute("x", "9");
    rect.setAttribute("y", "9");
    rect.setAttribute("rx", "2");
    rect.setAttribute("ry", "2");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1");
    svg.appendChild(rect);
    svg.appendChild(path);
    return svg;
  }

  function messageTextById(id) {
    const messages = (lastChat && lastChat.messages) || [];
    let found = "";
    messages.forEach(function (msg) {
      if (msg.id === id) found = String(msg.text || "");
    });
    return found;
  }

  function startUserEdit(id) {
    if (!id || id === "pending") return;
    const raw = messageTextById(id);
    if (!raw) return;
    if (document.querySelector(".chat-user.is-editing")) renderChat(lastChat);
    const row = document.querySelector('.chat-row.chat-user[data-id="' + id + '"]');
    if (!row) return;
    const bubble = row.querySelector(".chat-bubble");
    if (!bubble) return;
    row.classList.add("is-editing");
    bubble.innerHTML = "";
    const ta = document.createElement("textarea");
    ta.className = "chat-edit-input";
    ta.rows = Math.max(2, raw.split("\n").length);
    ta.value = raw;
    ta.setAttribute("aria-label", "Edit question");
    function fitEditInput() {
      ta.style.height = "auto";
      ta.style.height = Math.ceil(ta.scrollHeight) + "px";
    }
    const actions = document.createElement("div");
    actions.className = "chat-edit-actions";
    const go = document.createElement("button");
    go.type = "button";
    go.className = "chat-tool";
    go.setAttribute("data-edit-send", id);
    go.textContent = "Ask";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "chat-tool";
    cancel.setAttribute("data-edit-cancel", "1");
    cancel.textContent = "Cancel";
    actions.appendChild(cancel);
    actions.appendChild(go);
    const wrap = document.createElement("div");
    wrap.className = "chat-edit-wrap";
    wrap.appendChild(ta);
    wrap.addEventListener("click", function () { ta.focus(); });
    bubble.appendChild(wrap);
    bubble.appendChild(actions);
    fitEditInput();
    ta.addEventListener("input", fitEditInput);
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    function sendEdit() {
      const next = ta.value.trim();
      if (!next) return;
      sendChat("ask", next, "", id);
    }
    ta.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        renderChat(lastChat);
        return;
      }
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        sendEdit();
      }
    });
    go.addEventListener("click", sendEdit);
    cancel.addEventListener("click", function () {
      renderChat(lastChat);
    });
  }

  function renderChat(data) {
    const log = document.getElementById("memory-chat-log");
    const copyBtn = document.getElementById("memory-chat-copy");
    const askBox = document.getElementById("memory-ask");
    if (!log) return;
    lastChat = data || lastChat;
    const messages = (data && data.messages) || [];
    log.innerHTML = "";
    const on = aiEnabled();
    if (data && data.note_changed) {
      const already = messages.some(function (msg) {
        return msg.kind === "note_changed" && msg.note_sha === data.note_sha;
      });
      if (!already) {
        const meta = document.createElement("p");
        meta.className = "chat-meta";
        meta.textContent = "Note updated. Chat kept.";
        log.appendChild(meta);
      }
    }
    messages.forEach(function (msg) {
      if (msg.kind === "note_snapshot" || msg.kind === "note_changed") {
        const meta = document.createElement("p");
        meta.className = "chat-meta";
        meta.textContent = msg.text || (msg.kind === "note_changed" ? "Note updated. Chat kept." : "");
        if (meta.textContent) log.appendChild(meta);
        return;
      }
      if (msg.role !== "user" && msg.role !== "assistant") return;
      const row = document.createElement("div");
      row.className = "chat-row " + (msg.role === "user" ? "chat-user" : "chat-ai");
      row.dataset.id = msg.id || "";
      if (msg.role === "user" && msg.id && msg.id !== "pending") {
        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "chat-edit";
        edit.setAttribute("data-edit", msg.id);
        edit.setAttribute("aria-label", "Edit question");
        edit.title = "Edit and ask again";
        edit.appendChild(pencilSvg());
        row.appendChild(edit);
      }
      const bubble = document.createElement("div");
      bubble.className = "chat-bubble";
      if (msg.ok === false) bubble.classList.add("is-err");
      bubble.appendChild(chatMarkdown(msg.text || "", currentPath));
      row.appendChild(bubble);
      if (msg.role === "assistant") {
        const tools = document.createElement("div");
        tools.className = "chat-tools";
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "chat-tool";
        retry.setAttribute("data-retry", msg.id || "");
        retry.setAttribute("aria-label", "Retry");
        retry.title = "Retry";
        retry.appendChild(regenerateSvg());
        const copyOne = document.createElement("button");
        copyOne.type = "button";
        copyOne.className = "chat-tool";
        copyOne.setAttribute("data-copy-one", "1");
        copyOne.setAttribute("aria-label", "Copy");
        copyOne.title = "Copy";
        copyOne.appendChild(copySvg());
        tools.appendChild(retry);
        tools.appendChild(copyOne);
        row.appendChild(tools);
      }
      log.appendChild(row);
    });
    const hasTurns = chatHasTurns(messages);
    if (copyBtn) copyBtn.hidden = !(on && hasTurns);
    if (askBox) {
      if (!on || askClosed) askBox.hidden = true;
      else if (hasTurns) askBox.hidden = false;
    }
    syncAskToggle();
    log.scrollTop = log.scrollHeight;
  }

  function chatHasTurns(messages) {
    return (messages || []).some(function (msg) {
      return msg.role === "user" || msg.role === "assistant";
    });
  }

  async function loadChat(path) {
    if (!path) return;
    askClosed = true;
    const pendingBox = document.getElementById("memory-ask");
    if (pendingBox) pendingBox.hidden = true;
    syncAskToggle();
    const gen = ++chatGen;
    try {
      const res = await fetch("/api/chat?path=" + encodeURIComponent(path), { cache: "no-store" });
      const data = await res.json().catch(function () { return {}; });
      if (gen !== chatGen || path !== currentPath) return;
      askClosed = !chatHasTurns(data && data.messages);
      renderChat(data);
    } catch (err) {
      if (gen === chatGen) {
        askClosed = true;
        renderChat({ messages: [] });
      }
    }
  }

  async function sendChat(preset, extra, retryId, editId) {
    const askBox = document.getElementById("memory-ask");
    const log = document.getElementById("memory-chat-log");
    if (!aiEnabled()) {
      setAskOpen(true);
      if (log) {
        log.innerHTML = '<p class="chat-meta">Turn AI on first.</p>';
      }
      return;
    }
    setAskOpen(true);
    if (editId && extra) {
      const prior = ((lastChat && lastChat.messages) || []).slice();
      let idx = -1;
      prior.forEach(function (msg, i) {
        if (idx < 0 && msg.id === editId) idx = i;
      });
      const trimmed = idx >= 0 ? prior.slice(0, idx + 1) : prior;
      if (trimmed.length) {
        trimmed[trimmed.length - 1] = Object.assign({}, trimmed[trimmed.length - 1], { text: extra, ok: true });
      }
      renderChat({
        messages: trimmed,
        note_changed: lastChat && lastChat.note_changed,
        note_sha: lastChat && lastChat.note_sha,
      });
    } else if (!retryId && extra) {
      const prior = ((lastChat && lastChat.messages) || []).slice();
      renderChat({
        messages: prior.concat([{ id: "pending", role: "user", kind: "chat", text: extra, ok: true }]),
        note_changed: lastChat && lastChat.note_changed,
        note_sha: lastChat && lastChat.note_sha,
      });
    }
    if (log) {
      const pending = document.createElement("p");
      pending.className = "chat-meta";
      pending.textContent = retryId ? "Retrying…" : "Asking…";
      log.appendChild(pending);
      log.scrollTop = log.scrollHeight;
    }
    const url = editId ? "/api/chat/edit" : (retryId ? "/api/chat/retry" : "/api/chat");
    const body = editId
      ? { path: currentPath, id: editId, prompt: extra || "" }
      : retryId
        ? { path: currentPath, id: retryId }
        : { path: currentPath, preset: preset || "ask", prompt: extra || "" };
    const data = await postJSON(url, body);
    renderChat(data);
    if (!data.ok && !(data.messages && data.messages.length)) {
      if (log) {
        const err = document.createElement("p");
        err.className = "chat-meta";
        err.textContent = data.error || "Chat failed";
        log.appendChild(err);
      }
    }
  }

  const selMenu = document.getElementById("sel-menu");
  let lastSelText = "";
  let lastSelRect = null;

  function hideSelMenu() {
    if (!selMenu) return;
    selMenu.hidden = true;
    const box = document.getElementById("sel-insight-box");
    if (box) box.hidden = true;
    const hint = document.getElementById("sel-hint");
    if (hint) hint.hidden = true;
  }

  function selectionInDoc() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return "";
    const range = sel.getRangeAt(0);
    const node = range.commonAncestorContainer;
    const el = node && node.nodeType === 1 ? node : node.parentElement;
    if (!el || !article.contains(el)) return "";
    if (selMenu && selMenu.contains(el)) return "";
    const text = String(sel.toString() || "").replace(/\s+/g, " ").trim();
    if (text.length < 2) return "";
    lastSelRect = range.getBoundingClientRect();
    return text.slice(0, 4000);
  }

  function placeSelMenu() {
    if (!selMenu || selMenu.hidden) return;
    const rect = lastSelRect;
    if (!rect || (!rect.width && !rect.height)) return;
    const mw = selMenu.offsetWidth || 180;
    const mh = selMenu.offsetHeight || 44;
    let left = rect.left + rect.width / 2 - mw / 2;
    let top = rect.top - mh - 10;
    if (top < 8) top = rect.bottom + 10;
    left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
    top = Math.max(8, Math.min(top, window.innerHeight - mh - 8));
    selMenu.style.left = Math.round(left) + "px";
    selMenu.style.top = Math.round(top) + "px";
  }

  function showSelMenu(text) {
    if (!selMenu) return;
    lastSelText = text;
    hidePeek();
    const box = document.getElementById("sel-insight-box");
    if (box) box.hidden = true;
    selMenu.hidden = false;
    placeSelMenu();
  }

  function openSelInsight() {
    const box = document.getElementById("sel-insight-box");
    const quote = document.getElementById("sel-quote");
    const input = document.getElementById("sel-input");
    const hint = document.getElementById("sel-hint");
    if (!box) return;
    const clip = lastSelText || "";
    if (quote) quote.textContent = clip.length > 280 ? clip.slice(0, 277) + "…" : clip;
    if (input) input.value = "";
    if (hint) hint.hidden = aiEnabled();
    box.hidden = false;
    selMenu.hidden = false;
    placeSelMenu();
    if (input && aiEnabled()) input.focus();
  }

  function insightPrompt(kind, extra) {
    const clip = (lastSelText || "").trim();
    const block = "\n\nSelected passage:\n\n" + clip;
    if (kind === "explain") {
      return "I don't understand what this text is talking about. Explain it more clearly and simply." + block;
    }
    if (kind === "simplify") {
      return "Rewrite this passage in simpler language. Keep the meaning. Do not add new claims." + block;
    }
    const q = (extra || "").trim() || "Explain this passage more clearly and simply.";
    return q + block;
  }

  function runInsight(kind) {
    const input = document.getElementById("sel-input");
    const hint = document.getElementById("sel-hint");
    if (!lastSelText) return;
    if (!aiEnabled()) {
      if (hint) hint.hidden = false;
      return;
    }
    const extra = kind === "ask" ? (input ? input.value : "") : "";
    hideSelMenu();
    sendChat("ask", insightPrompt(kind, extra));
    const askBox = document.getElementById("memory-ask");
    if (askBox) askBox.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  function bindSelection() {
    if (!selMenu) return;
    document.addEventListener("mouseup", function (ev) {
      if (selMenu.contains(ev.target)) return;
      if (isTypingTarget(ev.target)) {
        hideSelMenu();
        return;
      }
      window.setTimeout(function () {
        const text = selectionInDoc();
        if (text) showSelMenu(text);
        else hideSelMenu();
      }, 10);
    });
    document.addEventListener("touchend", function (ev) {
      if (selMenu.contains(ev.target)) return;
      window.setTimeout(function () {
        const text = selectionInDoc();
        if (text) showSelMenu(text);
      }, 80);
    }, { passive: true });
    document.getElementById("sel-copy").addEventListener("click", function () {
      const text = lastSelText || "";
      if (!text) return;
      function ok() { hideSelMenu(); }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(ok).catch(function () { fallbackCopy(text, ok); });
      } else {
        fallbackCopy(text, ok);
      }
    });
    document.getElementById("sel-insight").addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      openSelInsight();
    });
    document.getElementById("sel-ask").addEventListener("click", function () {
      runInsight("ask");
    });
    selMenu.addEventListener("click", function (ev) {
      const btn = ev.target.closest("[data-insight]");
      if (!btn) return;
      runInsight(btn.getAttribute("data-insight"));
    });
    const selInput = document.getElementById("sel-input");
    if (selInput) {
      selInput.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" && !ev.shiftKey) {
          ev.preventDefault();
          runInsight("ask");
        }
      });
    }
  }

  async function loadPromptCatalog() {
    try {
      const res = await fetch("/api/ai", { cache: "no-store" });
      const data = await res.json();
      aiPrompts = data.prompts || [];
      renderMemoryActions();
    } catch (err) {
      aiPrompts = [];
    }
  }

  function bindMemory() {
    const keysEl = document.getElementById("memory-keys");
    if (keysEl) {
      keysEl.addEventListener("click", function (ev) {
        const btn = ev.target.closest("[data-keyword]");
        if (!btn || !keysEl.contains(btn)) return;
        const term = btn.getAttribute("data-keyword") || "";
        selectKeyword(term);
      });
    }
    const relatedEl = document.getElementById("memory-related");
    if (relatedEl) {
      relatedEl.addEventListener("click", function (ev) {
        const btn = ev.target.closest("[data-path]");
        if (!btn) return;
        const path = btn.getAttribute("data-path");
        if (path) loadDoc(path, "", false);
      });
    }
    const actions = document.getElementById("memory-actions");
    if (actions) {
      actions.addEventListener("click", function (ev) {
        const btn = ev.target.closest("[data-preset]");
        if (!btn) return;
        sendChat(btn.getAttribute("data-preset"), "");
      });
    }
    const metaBtn = document.getElementById("memory-meta-toggle");
    if (metaBtn) {
      metaBtn.addEventListener("click", function () {
        setMetaOpen(!metaOpen);
      });
    }
    const graphHome = document.getElementById("memory-graph-home");
    const graphIn = document.getElementById("memory-graph-in");
    const graphOut = document.getElementById("memory-graph-out");
    const graphExpand = document.getElementById("memory-graph-expand");
    if (graphHome) graphHome.addEventListener("click", homeGraph);
    if (graphIn) graphIn.addEventListener("click", function () { zoomGraph(1.25); });
    if (graphOut) graphOut.addEventListener("click", function () { zoomGraph(0.8); });
    if (graphExpand) graphExpand.addEventListener("click", function () { setMetaWide(!metaWide); });
    const askBtn = document.getElementById("memory-ask-toggle");
    const askBox = document.getElementById("memory-ask");
    if (askBtn && askBox) {
      askBtn.addEventListener("click", function () {
        const open = askBox.hidden;
        setAskOpen(open);
        if (open) {
          const input = document.getElementById("memory-ask-input");
          if (input) input.focus();
        }
      });
    }
    function submitAsk() {
      const input = document.getElementById("memory-ask-input");
      const prompt = input ? input.value.trim() : "";
      if (!prompt) return;
      if (input) input.value = "";
      sendChat("ask", prompt);
    }
    const askGo = document.getElementById("memory-ask-go");
    if (askGo) askGo.addEventListener("click", submitAsk);
    const askInput = document.getElementById("memory-ask-input");
    if (askInput) {
      askInput.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" && !ev.shiftKey) {
          ev.preventDefault();
          submitAsk();
        }
      });
    }
    const log = document.getElementById("memory-chat-log");
    if (log) {
      log.addEventListener("click", function (ev) {
        const editBtn = ev.target.closest("[data-edit]");
        if (editBtn) {
          startUserEdit(editBtn.getAttribute("data-edit"));
          return;
        }
        const retry = ev.target.closest("[data-retry]");
        if (retry) {
          const id = retry.getAttribute("data-retry");
          if (id) sendChat("ask", "", id);
          return;
        }
        const copyOne = ev.target.closest("[data-copy-one]");
        if (copyOne) {
          const row = copyOne.closest(".chat-row");
          const text = row ? (row.querySelector(".chat-md") && row.querySelector(".chat-md").innerText) || "" : "";
          if (text) {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(text).catch(function () { fallbackCopy(text, function () {}); });
            } else {
              fallbackCopy(text, function () {});
            }
          }
        }
      });
    }
    const copyBtn = document.getElementById("memory-chat-copy");
    if (copyBtn) {
      copyBtn.addEventListener("click", function () {
        const text = chatAsMarkdown((lastChat && lastChat.messages) || []);
        if (!text) return;
        function ok() {
          copyBtn.title = "Copied";
          setTimeout(function () { copyBtn.title = "Copy chat"; }, 1400);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(ok).catch(function () { fallbackCopy(text, ok); });
        } else {
          fallbackCopy(text, ok);
        }
      });
    }
  }

  function groupOrder() {
    const seen = [];
    notes.forEach(function (n) {
      const g = n.group || folderTitle;
      if (seen.indexOf(g) === -1) seen.push(g);
    });
    return seen;
  }

  function foldMap() {
    try {
      return JSON.parse(localStorage.getItem(FOLD_KEY) || "{}") || {};
    } catch (e) {
      return {};
    }
  }

  function groupIsCollapsed(name) {
    const m = foldMap()[folderKey] || {};
    return !!m[name];
  }

  function persistCollapsed(name, collapsed) {
    const all = foldMap();
    if (!all[folderKey]) all[folderKey] = {};
    if (collapsed) all[folderKey][name] = true;
    else delete all[folderKey][name];
    try {
      localStorage.setItem(FOLD_KEY, JSON.stringify(all));
    } catch (e) { /* ignore */ }
  }

  function syncFoldButton(sec) {
    const btn = sec.querySelector(".nav-fold");
    const g = sec.dataset.group || "";
    const collapsed = sec.classList.contains("is-collapsed");
    if (!btn) return;
    btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
    btn.setAttribute("aria-label", (collapsed ? "Show " : "Hide ") + g);
    btn.title = collapsed ? "Show" : "Hide";
  }

  function setCollapsed(sec, collapsed) {
    sec.classList.toggle("is-collapsed", collapsed);
    persistCollapsed(sec.dataset.group, collapsed);
    syncFoldButton(sec);
    updateAllButton();
  }

  function updateAllButton() {
    if (!navAll) return;
    const groups = navList.querySelectorAll(".nav-group");
    navAll.hidden = groups.length === 0;
    let anyOpen = false;
    groups.forEach(function (sec) {
      if (!sec.classList.contains("is-collapsed")) anyOpen = true;
    });
    navAll.textContent = anyOpen ? "Hide all" : "Show all";
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function highlightIndexes(text, indexes) {
    text = String(text || "");
    if (!indexes || !indexes.length) return escapeHtml(text);
    const on = Object.create(null);
    for (let i = 0; i < indexes.length; i++) on[indexes[i]] = true;
    let html = "";
    let i = 0;
    while (i < text.length) {
      if (on[i]) {
        let j = i;
        while (j < text.length && on[j]) j += 1;
        html += "<mark>" + escapeHtml(text.slice(i, j)) + "</mark>";
        i = j;
      } else {
        let j = i + 1;
        while (j < text.length && !on[j]) j += 1;
        html += escapeHtml(text.slice(i, j));
        i = j;
      }
    }
    return html;
  }

  function setHighlighted(el, text, indexes) {
    if (!el) return;
    if (indexes && indexes.length) el.innerHTML = highlightIndexes(text, indexes);
    else el.textContent = text;
  }

  function fuzzyReady() {
    return typeof fuzzysort !== "undefined" && fuzzysort && typeof fuzzysort.go === "function";
  }

  function applyFilter() {
    const query = ((filterInput && filterInput.value) || "").trim();
    const links = navList.querySelectorAll(".nav-group-body a");
    const fuzzy = fuzzyReady();

    if (!query) {
      links.forEach(function (a) {
        a.hidden = false;
        a.textContent = a.dataset.label || "";
      });
    } else if (fuzzy) {
      const items = [];
      links.forEach(function (a) {
        items.push({
          el: a,
          label: a.dataset.label || "",
          hay: (a.dataset.titleLabel || "") + " " + (a.dataset.fileLabel || "") + " " + (a.dataset.path || "") + " " + (a.dataset.group || ""),
        });
      });
      const hits = fuzzysort.go(query, items, { key: "hay", threshold: 0.4 });
      const matched = new Set();
      hits.forEach(function (hit) {
        const el = hit.obj.el;
        matched.add(el);
        el.hidden = false;
        const labelHit = fuzzysort.single(query, hit.obj.label);
        setHighlighted(el, hit.obj.label, labelHit && labelHit.indexes);
      });
      links.forEach(function (a) {
        if (matched.has(a)) return;
        a.hidden = true;
        a.textContent = a.dataset.label || "";
      });
    } else {
      const q = query.toLowerCase();
      links.forEach(function (a) {
        const hay = ((a.dataset.titleLabel || "") + " " + (a.dataset.fileLabel || "") + " " + (a.dataset.path || "")).toLowerCase();
        a.hidden = hay.indexOf(q) === -1;
        a.textContent = a.dataset.label || "";
      });
    }

    let shown = 0;
    navList.querySelectorAll(".nav-group").forEach(function (sec) {
      let visible = 0;
      sec.querySelectorAll(".nav-group-body a").forEach(function (a) {
        if (!a.hidden) visible += 1;
      });
      sec.hidden = visible === 0;
      if (query && visible) sec.classList.remove("is-collapsed");
      else if (!query) sec.classList.toggle("is-collapsed", groupIsCollapsed(sec.dataset.group));
      const folder = sec.querySelector(".nav-folder");
      if (folder) {
        const name = folder.dataset.label || "";
        if (query && fuzzy) {
          const fh = fuzzysort.single(query, name);
          setHighlighted(folder, name, fh && fh.indexes);
        } else {
          folder.textContent = name;
        }
      }
      syncFoldButton(sec);
      shown += visible;
    });
    if (navEmpty) navEmpty.hidden = shown > 0;
    updateAllButton();
  }

  function renderNav() {
    const by = Object.create(null);
    notes.forEach(function (n) {
      const g = n.group || folderTitle;
      if (!by[g]) by[g] = [];
      by[g].push(n);
    });
    navList.innerHTML = "";
    groupOrder().forEach(function (g) {
      const items = by[g];
      if (!items || !items.length) return;
      const sec = document.createElement("section");
      sec.className = "nav-group";
      sec.dataset.group = g;
      const head = document.createElement("div");
      head.className = "nav-group-head";
      const fold = document.createElement("button");
      fold.type = "button";
      fold.className = "nav-fold";
      const chev = document.createElement("span");
      chev.className = "nav-chevron";
      chev.setAttribute("aria-hidden", "true");
      fold.appendChild(chev);
      fold.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        setCollapsed(sec, !sec.classList.contains("is-collapsed"));
      });
      const label = document.createElement("p");
      label.className = "nav-folder";
      label.dataset.label = g;
      label.textContent = g;
      head.appendChild(fold);
      head.appendChild(label);
      const body = document.createElement("div");
      body.className = "nav-group-body";
      items.forEach(function (n) {
        const a = document.createElement("a");
        a.href = "?doc=" + encodeURIComponent(n.path);
        a.dataset.path = n.path;
        a.dataset.group = g;
        a.dataset.titleLabel = shortTitle(n);
        a.dataset.fileLabel = fileNameOf(n);
        paintNoteLink(a);
        a.textContent = a.dataset.label;
        a.addEventListener("click", function (ev) {
          if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return;
          ev.preventDefault();
          closeNav();
          loadDoc(n.path, "", false);
        });
        body.appendChild(a);
      });
      sec.appendChild(head);
      sec.appendChild(body);
      if (groupIsCollapsed(g)) sec.classList.add("is-collapsed");
      syncFoldButton(sec);
      navList.appendChild(sec);
    });
    applyFilter();
  }

  let navLabelMode = "title";
  try {
    if (localStorage.getItem(LABEL_KEY) === "file") navLabelMode = "file";
  } catch (e) { /* ignore */ }

  function fileNameOf(n) {
    const path = String((n && n.path) || "");
    const slash = path.lastIndexOf("/");
    return slash === -1 ? path : path.slice(slash + 1);
  }

  function syncLabelSwitch() {
    const titleBtn = document.getElementById("nav-label-title");
    const fileBtn = document.getElementById("nav-label-file");
    if (titleBtn) titleBtn.setAttribute("aria-pressed", navLabelMode === "title" ? "true" : "false");
    if (fileBtn) fileBtn.setAttribute("aria-pressed", navLabelMode === "file" ? "true" : "false");
  }

  function paintNoteLink(a) {
    const titleLabel = a.dataset.titleLabel || "";
    const fileLabel = a.dataset.fileLabel || "";
    const shown = navLabelMode === "file" ? fileLabel : titleLabel;
    const other = navLabelMode === "file" ? titleLabel : fileLabel;
    a.dataset.label = shown;
    if (other && other !== shown) a.title = other;
    else a.removeAttribute("title");
  }

  function setNavLabelMode(mode) {
    navLabelMode = mode === "file" ? "file" : "title";
    try {
      localStorage.setItem(LABEL_KEY, navLabelMode);
    } catch (e) { /* ignore */ }
    syncLabelSwitch();
    navList.querySelectorAll(".nav-group-body a").forEach(paintNoteLink);
    applyFilter();
  }

  syncLabelSwitch();
  const navLabelTitle = document.getElementById("nav-label-title");
  const navLabelFile = document.getElementById("nav-label-file");
  if (navLabelTitle) navLabelTitle.addEventListener("click", function () { setNavLabelMode("title"); });
  if (navLabelFile) navLabelFile.addEventListener("click", function () { setNavLabelMode("file"); });

  function shortTitle(n) {
    const t = n.title
      .replace(/^\d+\.\s*/, "")
      .replace(/\\\(([\s\S]*?)\\\)/g, "$1")
      .replace(/\\\[([\s\S]*?)\\\]/g, "$1");
    const name = n.path.split("/").pop();
    if (/^readme\.(md|markdown|mdown|mkd)$/i.test(name)) return "Overview";
    if (/^glossary\.(md|markdown|mdown|mkd)$/i.test(name)) return "Glossary";
    if (n.path.indexOf("/") !== -1) {
      let rest = n.path.replace(/\.(md|markdown|mdown|mkd)$/i, "");
      if (n.group && rest.indexOf(n.group + "/") === 0) {
        rest = rest.slice(n.group.length + 1);
      }
      return rest;
    }
    const m = name.match(/^(\d+)-/);
    if (m) return m[1] + " · " + t;
    return t;
  }

  function closeNav() {
    navEl.classList.remove("open");
    scrim.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
  }

  function openNav() {
    navEl.classList.add("open");
    scrim.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
  }

  function applyZen(on) {
    appEl.classList.toggle("zen", on);
    if (zenBtn) {
      zenBtn.setAttribute("aria-pressed", on ? "true" : "false");
      zenBtn.textContent = on ? "Notes" : "Wide";
      zenBtn.title = on ? "Show notes list" : "Hide notes list — more width";
    }
    try {
      localStorage.setItem(ZEN_KEY, on ? "1" : "0");
    } catch (e) { /* ignore */ }
    const zenCheck = document.getElementById("cfg-zen");
    if (zenCheck) zenCheck.checked = !!on;
    if (!on) applySavedRailWidth();
  }

  function isDesktopRail() {
    return window.matchMedia("(min-width: 861px)").matches && !appEl.classList.contains("zen");
  }

  function railMax() {
    return Math.max(RAIL_MIN, Math.min(Math.round(window.innerWidth * 0.72), window.innerWidth - 280));
  }

  function currentRailWidth() {
    return navEl.getBoundingClientRect().width;
  }

  function setRailWidth(px, persist) {
    const w = Math.round(Math.max(RAIL_MIN, Math.min(railMax(), Number(px) || RAIL_MIN)));
    document.documentElement.style.setProperty("--rail-w", w + "px");
    if (resizeHandle) {
      resizeHandle.setAttribute("aria-valuenow", String(w));
      resizeHandle.setAttribute("aria-valuemin", String(RAIL_MIN));
      resizeHandle.setAttribute("aria-valuemax", String(railMax()));
    }
    if (persist) {
      try {
        localStorage.setItem(RAIL_W_KEY, String(w));
      } catch (e) { /* ignore */ }
    }
    if (peekEl && !peekEl.hidden && peekAnchor) placePeek(peekAnchor);
  }

  function applySavedRailWidth() {
    if (!isDesktopRail()) return;
    try {
      const saved = localStorage.getItem(RAIL_W_KEY);
      if (saved) {
        const n = Number(saved);
        if (n > 0) setRailWidth(n, false);
      } else if (resizeHandle) {
        setRailWidth(currentRailWidth(), false);
      }
    } catch (e) { /* ignore */ }
  }

  function updateChrome() {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    if (progressEl) progressEl.style.transform = "scaleX(" + p + ")";
    if (toTop) toTop.hidden = window.scrollY < 420;
  }

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = (el.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    return !!el.isContentEditable;
  }

  toggle.addEventListener("click", function () {
    if (navEl.classList.contains("open")) closeNav();
    else openNav();
  });
  scrim.addEventListener("click", closeNav);

  if (zenBtn) {
    zenBtn.addEventListener("click", function () {
      applyZen(!appEl.classList.contains("zen"));
    });
  }

  (function bindRailResize() {
    if (!resizeHandle) return;
    let dragging = false;
    resizeHandle.addEventListener("pointerdown", function (ev) {
      if (ev.button !== 0 || !isDesktopRail()) return;
      ev.preventDefault();
      dragging = true;
      document.body.classList.add("rail-resizing");
      hidePeek();
      try {
        resizeHandle.setPointerCapture(ev.pointerId);
      } catch (e) { /* ignore */ }
    });
    resizeHandle.addEventListener("pointermove", function (ev) {
      if (!dragging) return;
      const left = navEl.getBoundingClientRect().left;
      setRailWidth(ev.clientX - left, false);
    });
    function endDrag(ev) {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove("rail-resizing");
      if (ev && ev.pointerId != null) {
        try {
          resizeHandle.releasePointerCapture(ev.pointerId);
        } catch (e) { /* ignore */ }
      }
      setRailWidth(currentRailWidth(), true);
    }
    resizeHandle.addEventListener("pointerup", endDrag);
    resizeHandle.addEventListener("pointercancel", endDrag);
    resizeHandle.addEventListener("keydown", function (ev) {
      if (!isDesktopRail()) return;
      const step = ev.shiftKey ? 48 : 16;
      if (ev.key === "ArrowLeft") {
        ev.preventDefault();
        setRailWidth(currentRailWidth() - step, true);
      } else if (ev.key === "ArrowRight") {
        ev.preventDefault();
        setRailWidth(currentRailWidth() + step, true);
      } else if (ev.key === "Home") {
        ev.preventDefault();
        setRailWidth(RAIL_MIN, true);
      } else if (ev.key === "End") {
        ev.preventDefault();
        setRailWidth(railMax(), true);
      }
    });
  })();
  if (filterInput) {
    filterInput.addEventListener("input", applyFilter);
  }
  if (navAll) {
    navAll.addEventListener("click", function () {
      const groups = navList.querySelectorAll(".nav-group");
      let anyOpen = false;
      groups.forEach(function (sec) {
        if (!sec.classList.contains("is-collapsed")) anyOpen = true;
      });
      const collapse = anyOpen;
      groups.forEach(function (sec) {
        sec.classList.toggle("is-collapsed", collapse);
        persistCollapsed(sec.dataset.group, collapse);
        syncFoldButton(sec);
      });
      updateAllButton();
    });
  }
  if (toTop) {
    toTop.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  document.getElementById("lb-close").addEventListener("click", function (ev) {
    ev.stopPropagation();
    closeLightbox();
  });
  lightbox.addEventListener("click", function (ev) {
    if (ev.target === lightbox || ev.target === lbCap || ev.target === lbStage) closeLightbox();
  });

  bindPeekRoot(article);
  bindPeekRoot(navList);
  if (navList) {
    navList.addEventListener("scroll", function () {
      if (!peekEl || peekEl.hidden) return;
      if (peekAnchor && peekAnchor.matches(":hover")) placePeek(peekAnchor);
      else hidePeek();
    }, { passive: true });
  }
  if (peekEl) {
    peekEl.addEventListener("pointerenter", function () {
      clearTimeout(peekHideTimer);
    });
    peekEl.addEventListener("pointerleave", scheduleHidePeek);
  }

  article.addEventListener("click", function (ev) {
    const a = ev.target.closest("a[href]");
    if (!a || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button !== 0) return;
    const href = a.getAttribute("href") || "";
    if (href.charAt(0) !== "#") return;
    const hash = href.slice(1);
    if (!hash) return;
    ev.preventDefault();
    setRoute(currentPath, hash, false);
    scrollToHash(hash);
  });

  document.addEventListener("keydown", function (ev) {
    const typing = isTypingTarget(ev.target);
    if (ev.key === "Escape") {
      if (selMenu && !selMenu.hidden) hideSelMenu();
      else if (settingsEl && !settingsEl.hidden) closeSettings();
      else if (peekEl && !peekEl.hidden) hidePeek();
      else if (!lightbox.hidden) closeLightbox();
      else closeNav();
      if (typing && filterInput) filterInput.blur();
      return;
    }
    if (typing) {
      if (ev.key === "Enter" && ev.target === filterInput) {
        const first = navList.querySelector("a:not([hidden])");
        if (first) {
          ev.preventDefault();
          closeNav();
          loadDoc(first.dataset.path, "", false);
        }
      }
      return;
    }
    if (ev.key === "/" && !ev.metaKey && !ev.ctrlKey) {
      ev.preventDefault();
      if (appEl.classList.contains("zen")) applyZen(false);
      openNav();
      if (filterInput) filterInput.focus();
      return;
    }
    if (ev.key === "[") {
      ev.preventDefault();
      neighbor(-1);
      return;
    }
    if (ev.key === "]") {
      ev.preventDefault();
      neighbor(1);
      return;
    }
    if (ev.key === "w" || ev.key === "W") {
      applyZen(!appEl.classList.contains("zen"));
    }
  });

  window.addEventListener("scroll", updateChrome, { passive: true });
  window.addEventListener("resize", function () {
    updateChrome();
    applySavedRailWidth();
    if (peekEl && !peekEl.hidden && peekAnchor) placePeek(peekAnchor);
    if (selMenu && !selMenu.hidden) placeSelMenu();
    if (metaOpen) {
      window.clearTimeout(metaResizeTimer);
      metaResizeTimer = window.setTimeout(refreshMeta, 140);
    }
  });
  window.addEventListener("scroll", function () {
    if (selMenu && !selMenu.hidden) hideSelMenu();
    if (!peekEl || peekEl.hidden) return;
    if (peekAnchor && peekAnchor.matches(":hover")) {
      placePeek(peekAnchor);
      return;
    }
    hidePeek();
  }, { passive: true });

  function typeStep() {
    return Number(article.getAttribute("data-type") || "1");
  }
  function setType(n) {
    const v = Math.max(0, Math.min(TYPE_MAX, n));
    article.setAttribute("data-type", String(v));
    try {
      localStorage.setItem(TYPE_KEY, String(v));
    } catch (e) { /* ignore */ }
  }
  document.getElementById("type-up").addEventListener("click", function () {
    setType(typeStep() + 1);
  });
  document.getElementById("type-down").addEventListener("click", function () {
    setType(typeStep() - 1);
  });
  try {
    const saved = localStorage.getItem(TYPE_KEY);
    if (saved !== null) setType(Number(saved));
  } catch (e) { /* ignore */ }
  try {
    if (localStorage.getItem(ZEN_KEY) === "1") applyZen(true);
  } catch (e) { /* ignore */ }
  applySavedRailWidth();

  window.addEventListener("popstate", function () {
    const r = routeFromLocation();
    loadDoc(r.path, r.hash, true);
  });

  function suggestedAiPath(src) {
    const clean = (src || "note.md").split("?")[0];
    const i = clean.lastIndexOf(".");
    if (i === -1) return clean + ".ai.md";
    return clean.slice(0, i) + ".ai" + clean.slice(i);
  }

  function syncRunDoc() {
    const el = document.getElementById("run-doc");
    if (el) el.textContent = currentPath || "—";
    const savePath = document.getElementById("run-save-path");
    if (savePath && currentPath && !savePath.dataset.touched) {
      savePath.value = suggestedAiPath(currentPath);
    }
  }

  function closeSettings() {
    if (!settingsEl) return;
    settingsEl.hidden = true;
    document.body.style.overflow = "";
  }

  function openSettings() {
    if (!settingsEl) return;
    hidePeek();
    closeLightbox();
    settingsEl.hidden = false;
    document.body.style.overflow = "hidden";
    const firstTab = document.getElementById("tab-viewer");
    if (firstTab) firstTab.focus();
  }

  function setSettingsTab(id) {
    ["viewer", "ai", "run"].forEach(function (name) {
      const tab = document.getElementById("tab-" + name);
      const pane = document.getElementById("pane-" + name);
      const on = name === id;
      if (tab) tab.setAttribute("aria-selected", on ? "true" : "false");
      if (pane) pane.hidden = !on;
    });
    if (id === "run") syncRunDoc();
  }

  function fillSelect(el, items, selected) {
    if (!el) return;
    el.innerHTML = "";
    items.forEach(function (item) {
      const opt = document.createElement("option");
      opt.value = item.id;
      opt.textContent = item.label || item.id;
      el.appendChild(opt);
    });
    if (selected) el.value = selected;
    if (selected && el.value !== selected && el.options.length) el.selectedIndex = 0;
  }

  function parseModels(raw) {
    return String(raw || "")
      .replace(/,/g, "\n")
      .split("\n")
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  function setStatus(el, msg, kind) {
    if (!el) return;
    el.textContent = msg || "";
    el.className = "settings-status" + (kind ? " " + kind : "");
  }

  async function postJSON(url, body) {
    const res = await fetch(url, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(function () { return {}; });
    data._status = res.status;
    return data;
  }

  function aiEnabled() {
    const btn = document.getElementById("ai-toggle");
    return !!(btn && btn.getAttribute("aria-pressed") === "true");
  }

  function applyAiEnabled(on) {
    const btn = document.getElementById("ai-toggle");
    if (btn) {
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.setAttribute("aria-label", on ? "AI on" : "AI off");
      btn.title = on ? "AI is on — click to turn off" : "AI is off — click to turn on";
    }
    document.body.classList.toggle("ai-on", !!on);
    const go = document.getElementById("run-go");
    if (go) go.disabled = !on;
    const hint = document.getElementById("sel-hint");
    const box = document.getElementById("sel-insight-box");
    if (hint && box && !box.hidden) hint.hidden = !!on;
    try { localStorage.setItem(AI_ON_KEY, on ? "1" : "0"); } catch (e) { /* ignore */ }
  }

  function bindAiToggle() {
    const btn = document.getElementById("ai-toggle");
    if (!btn) return;
    let on = false;
    try { on = localStorage.getItem(AI_ON_KEY) === "1"; } catch (e) { /* ignore */ }
    applyAiEnabled(on);
    btn.addEventListener("click", function () {
      applyAiEnabled(!aiEnabled());
      if (currentPath) renderMemoryFromLast();
      if (currentPath) renderChat(lastChat || { messages: [] });
      if (currentPath) syncMemory(currentPath);
    });
  }

  function bindSettings() {
    if (!settingsEl) return;
    const openBtn = document.getElementById("settings-open");
    const closeBtn = document.getElementById("settings-close");
    if (openBtn) openBtn.addEventListener("click", function () {
      openSettings();
      loadViewerForm();
      loadAiForm();
    });
    if (closeBtn) closeBtn.addEventListener("click", closeSettings);
    settingsEl.addEventListener("click", function (ev) {
      if (ev.target === settingsEl) closeSettings();
    });
    ["viewer", "ai", "run"].forEach(function (name) {
      const tab = document.getElementById("tab-" + name);
      if (tab) {
        tab.addEventListener("click", function () {
          setSettingsTab(name);
        });
      }
    });

    const typeDown = document.getElementById("cfg-type-down");
    const typeUp = document.getElementById("cfg-type-up");
    const railReset = document.getElementById("cfg-rail-reset");
    const zenCheck = document.getElementById("cfg-zen");
    if (typeDown) typeDown.addEventListener("click", function () { setType(typeStep() - 1); });
    if (typeUp) typeUp.addEventListener("click", function () { setType(typeStep() + 1); });
    if (railReset) {
      railReset.addEventListener("click", function () {
        try { localStorage.removeItem(RAIL_W_KEY); } catch (e) { /* ignore */ }
        document.documentElement.style.removeProperty("--rail-w");
        applySavedRailWidth();
      });
    }
    if (zenCheck) {
      zenCheck.checked = appEl.classList.contains("zen");
      zenCheck.addEventListener("change", function () {
        applyZen(zenCheck.checked);
      });
    }
    const cfgSave = document.getElementById("cfg-save");
    if (cfgSave) cfgSave.addEventListener("click", saveViewerForm);

    let aiProviders = {};
    let aiDefault = "";
    let aiCatalog = [];
    let aiCurrent = "";

    function captureAiForm() {
      const idEl = document.getElementById("ai-id");
      const pid = (idEl && idEl.value.trim()) || aiCurrent;
      if (!pid) return;
      const keyEl = document.getElementById("ai-key");
      const prev = aiProviders[pid] || {};
      aiProviders[pid] = {
        id: pid,
        label: (document.getElementById("ai-label").value || "").trim() || pid,
        base_url: (document.getElementById("ai-base").value || "").trim(),
        models: parseModels(document.getElementById("ai-models").value),
        service: prev.service || pid,
        api_key: keyEl ? keyEl.value : "",
        api_key_set: prev.api_key_set || false,
      };
      aiCurrent = pid;
    }

    function showAiForm(pid) {
      aiCurrent = pid;
      const p = aiProviders[pid] || {};
      document.getElementById("ai-id").value = pid;
      document.getElementById("ai-label").value = p.label || pid;
      document.getElementById("ai-base").value = p.base_url || "";
      document.getElementById("ai-models").value = (p.models || []).join("\n");
      const keyEl = document.getElementById("ai-key");
      keyEl.value = p.api_key_set || (p.api_key && p.api_key !== "") ? AI_KEY_MASK : "";
      const cat = aiCatalog.filter(function (c) { return c.id === (p.service || pid); })[0];
      const hint = document.getElementById("ai-hint");
      if (hint) hint.textContent = (cat && cat.hint) || "OpenAI-compatible Chat Completions. Base URL is the API root.";
    }

    function refreshAiSelects() {
      const saved = Object.keys(aiProviders).map(function (id) {
        const p = aiProviders[id];
        return { id: id, label: (p.label || id) + " [" + (p.service || id) + "]" };
      });
      if (!saved.length) saved.push({ id: "", label: "(none yet)" });
      fillSelect(document.getElementById("ai-default"), saved.filter(function (x) { return x.id; }), aiDefault);
      fillSelect(document.getElementById("ai-pick"), saved, aiCurrent);
      const catEl = document.getElementById("ai-catalog");
      const keepCat = catEl && catEl.value;
      fillSelect(
        catEl,
        aiCatalog.map(function (c) { return { id: c.id, label: c.label }; }),
        keepCat || (aiCatalog[0] && aiCatalog[0].id)
      );
      const runProv = Object.keys(aiProviders).map(function (id) {
        return { id: id, label: aiProviders[id].label || id };
      });
      fillSelect(document.getElementById("run-provider"), runProv, aiDefault || (runProv[0] && runProv[0].id));
      fillRunModels();
    }

    function fillRunModels() {
      const provEl = document.getElementById("run-provider");
      const modelEl = document.getElementById("run-model");
      const pid = provEl && provEl.value;
      const p = (pid && aiProviders[pid]) || {};
      function isEmbed(name) {
        const n = String(name || "").toLowerCase();
        return n.indexOf("embed") !== -1 || n.indexOf("bge-") !== -1 || n.indexOf("e5-") !== -1;
      }
      const chat = (p.models || []).filter(function (m) { return !isEmbed(m); });
      const models = (chat.length ? chat : p.models || []).map(function (m) { return { id: m, label: m }; });
      fillSelect(modelEl, models.length ? models : [{ id: "", label: "(set models on the Models tab)" }], models[0] && models[0].id);
    }

    function promptSpec(id) {
      for (let i = 0; i < aiPrompts.length; i += 1) {
        if (aiPrompts[i].id === id) return aiPrompts[i];
      }
      return null;
    }

    function updatePromptDesc() {
      const sel = document.getElementById("run-preset");
      const desc = document.getElementById("run-prompt-desc");
      const spec = promptSpec(sel && sel.value);
      if (desc) desc.textContent = spec ? (spec.description || "") : "";
    }

    function fillRunPrompts() {
      const sel = document.getElementById("run-preset");
      const items = aiPrompts.map(function (p) {
        return { id: p.id, label: p.label || p.id };
      });
      const keep = sel && sel.value;
      fillSelect(
        sel,
        items.length ? items : [{ id: "", label: "(add json files under ai/prompts)" }],
        keep || "summarize" || (items[0] && items[0].id)
      );
      updatePromptDesc();
    }

    function nextAiId(base) {
      let id = base || "custom";
      if (!aiProviders[id]) return id;
      let n = 2;
      while (aiProviders[id + "-" + n]) n += 1;
      return id + "-" + n;
    }

    async function loadAiForm() {
      const status = document.getElementById("ai-status");
      try {
        const res = await fetch("/api/ai", { cache: "no-store" });
        const data = await res.json();
        aiProviders = data.providers || {};
        aiDefault = data.default_provider || "";
        aiCatalog = data.catalog || [];
        aiPrompts = data.prompts || [];
        aiCurrent = aiDefault || Object.keys(aiProviders)[0] || "";
        refreshAiSelects();
        fillRunPrompts();
        if (aiCurrent) showAiForm(aiCurrent);
        setStatus(status, Object.keys(aiProviders).length ? "" : "Add a provider from the catalog.", "");
      } catch (err) {
        setStatus(status, "Could not load providers.", "err");
      }
    }

    const aiForm = document.getElementById("ai-form");
    if (aiForm) {
      aiForm.addEventListener("submit", function (ev) { ev.preventDefault(); });
    }
    document.getElementById("ai-pick").addEventListener("change", function () {
      captureAiForm();
      const pid = document.getElementById("ai-pick").value;
      if (pid) showAiForm(pid);
    });
    document.getElementById("ai-default").addEventListener("change", function () {
      aiDefault = document.getElementById("ai-default").value;
    });
    document.getElementById("ai-add").addEventListener("click", function () {
      captureAiForm();
      const catId = document.getElementById("ai-catalog").value || "custom";
      const cat = aiCatalog.filter(function (c) { return c.id === catId; })[0] || {};
      const pid = nextAiId(cat.suggested_id || cat.id || "custom");
      aiProviders[pid] = {
        id: pid,
        label: cat.label || pid,
        base_url: cat.base_url || "",
        models: (cat.models || []).slice(),
        service: catId,
        api_key: "",
        api_key_set: false,
      };
      if (!aiDefault) aiDefault = pid;
      aiCurrent = pid;
      refreshAiSelects();
      showAiForm(pid);
    });
    document.getElementById("ai-del").addEventListener("click", function () {
      captureAiForm();
      const pid = aiCurrent;
      if (!pid || !aiProviders[pid]) return;
      delete aiProviders[pid];
      if (aiDefault === pid) aiDefault = Object.keys(aiProviders)[0] || "";
      aiCurrent = aiDefault;
      refreshAiSelects();
      if (aiCurrent) showAiForm(aiCurrent);
      else {
        document.getElementById("ai-id").value = "";
        document.getElementById("ai-label").value = "";
        document.getElementById("ai-base").value = "";
        document.getElementById("ai-models").value = "";
        document.getElementById("ai-key").value = "";
      }
    });
    document.getElementById("ai-save").addEventListener("click", async function () {
      captureAiForm();
      const status = document.getElementById("ai-status");
      const payload = { default_provider: aiDefault, providers: {} };
      Object.keys(aiProviders).forEach(function (id) {
        const p = aiProviders[id];
        payload.providers[id] = {
          id: id,
          label: p.label,
          base_url: p.base_url,
          models: p.models,
          service: p.service,
          api_key: p.api_key,
        };
      });
      const data = await postJSON("/api/ai", payload);
      if (data.ok) {
        aiProviders = (data.ai && data.ai.providers) || aiProviders;
        aiDefault = (data.ai && data.ai.default_provider) || aiDefault;
        refreshAiSelects();
        setStatus(status, "Saved.", "ok");
      } else {
        setStatus(status, data.error || "Save failed.", "err");
      }
    });
    document.getElementById("ai-test").addEventListener("click", async function () {
      captureAiForm();
      const status = document.getElementById("ai-status");
      const resultEl = document.getElementById("ai-result");
      const p = aiProviders[aiCurrent] || {};
      setStatus(status, "Testing…");
      const data = await postJSON("/api/ai/test", {
        provider: aiCurrent,
        model: (p.models || [])[0] || "",
        base_url: p.base_url,
        api_key: p.api_key,
      });
      if (resultEl) {
        resultEl.hidden = false;
        resultEl.textContent = data.ok
          ? ("ok · " + (data.model || "") + "\n" + (data.text || "").slice(0, 400))
          : ((data.error || "failed") + (data.detail ? "\n" + data.detail : ""));
      }
      setStatus(status, data.ok ? "Connection ok." : (data.error || "Test failed."), data.ok ? "ok" : "err");
    });
    document.getElementById("ai-load").addEventListener("click", async function () {
      captureAiForm();
      const status = document.getElementById("ai-status");
      const p = aiProviders[aiCurrent] || {};
      setStatus(status, "Loading models…");
      const data = await postJSON("/api/ai/models", {
        provider: aiCurrent,
        base_url: p.base_url,
        api_key: p.api_key,
      });
      if (data.ok && data.models && data.models.length) {
        aiProviders[aiCurrent].models = data.models;
        document.getElementById("ai-models").value = data.models.join("\n");
        fillRunModels();
        setStatus(status, data.models.length + " models.", "ok");
      } else {
        setStatus(status, data.error || "Could not list models.", "err");
      }
    });

    const runSavePath = document.getElementById("run-save-path");
    if (runSavePath) {
      runSavePath.addEventListener("input", function () {
        runSavePath.dataset.touched = "1";
      });
    }
    document.getElementById("run-provider").addEventListener("change", fillRunModels);
    document.getElementById("run-preset").addEventListener("change", updatePromptDesc);
    document.getElementById("run-go").addEventListener("click", async function () {
      const status = document.getElementById("run-status");
      const out = document.getElementById("run-out");
      const preset = document.getElementById("run-preset").value;
      const prompt = document.getElementById("run-prompt").value.trim();
      if (!aiEnabled()) {
        setStatus(status, "Turn AI on in the header first.", "err");
        return;
      }
      const spec = promptSpec(preset);
      if (spec && spec.requires_prompt && !prompt) {
        setStatus(status, "Write a prompt for this catalog item.", "err");
        return;
      }
      if (!currentPath) {
        setStatus(status, "No note open.", "err");
        return;
      }
      setStatus(status, "Running…");
      if (out) out.value = "";
      const data = await postJSON("/api/ai/run", {
        path: currentPath,
        preset: preset,
        prompt: prompt,
        provider: document.getElementById("run-provider").value,
        model: document.getElementById("run-model").value,
      });
      if (data.ok) {
        if (out) out.value = data.text || "";
        setStatus(status, "Done" + (data.model ? " · " + data.model : "") + ".", "ok");
      } else {
        setStatus(status, data.error || "Run failed.", "err");
        if (out && data.detail) out.value = data.detail;
      }
    });
    document.getElementById("run-copy").addEventListener("click", async function () {
      const out = document.getElementById("run-out");
      const status = document.getElementById("run-status");
      const text = out ? out.value : "";
      if (!text) {
        setStatus(status, "Nothing to copy.", "err");
        return;
      }
      try {
        await navigator.clipboard.writeText(text);
        setStatus(status, "Copied.", "ok");
      } catch (err) {
        setStatus(status, "Could not copy.", "err");
      }
    });
    document.getElementById("run-save").addEventListener("click", async function () {
      const status = document.getElementById("run-status");
      const out = document.getElementById("run-out");
      const rel = (document.getElementById("run-save-path").value || "").trim();
      const text = out ? out.value : "";
      if (!rel || !text) {
        setStatus(status, "Need a path and a result.", "err");
        return;
      }
      const data = await postJSON("/api/ai/save", {
        path: rel,
        text: text,
        overwrite: document.getElementById("run-overwrite").checked,
      });
      if (data.ok) {
        notes = data.notes || notes;
        renderNav();
        setStatus(status, "Saved " + data.path + ".", "ok");
        loadDoc(data.path, "", false);
      } else {
        setStatus(status, data.error || "Save failed.", "err");
      }
    });

    async function loadViewerForm() {
      const status = document.getElementById("cfg-status");
      const restart = document.getElementById("cfg-restart");
      try {
        const res = await fetch("/api/config", { cache: "no-store" });
        const data = await res.json();
        document.getElementById("cfg-gutter").value = data.gutter || "";
        document.getElementById("cfg-recent-max").value = data.recent_max || 8;
        document.getElementById("cfg-start").value = data.start_dir || "~";
        document.getElementById("cfg-title").value = data.title || "";
        document.getElementById("cfg-host").value = data.host || "";
        document.getElementById("cfg-port").value = data.port || 8765;
        document.getElementById("cfg-shortcuts").value = (data.shortcuts || []).join("\n");
        document.getElementById("cfg-skip").value = (data.skip_dirs || []).join("\n");
        if (restart) restart.textContent = data.restart || "";
        if (zenCheck) zenCheck.checked = appEl.classList.contains("zen");
        setStatus(status, "");
      } catch (err) {
        setStatus(status, "Could not load config.", "err");
      }
    }

    async function saveViewerForm() {
      const status = document.getElementById("cfg-status");
      const data = await postJSON("/api/config", {
        gutter: document.getElementById("cfg-gutter").value,
        recent_max: document.getElementById("cfg-recent-max").value,
        start_dir: document.getElementById("cfg-start").value,
        title: document.getElementById("cfg-title").value,
        host: document.getElementById("cfg-host").value,
        port: document.getElementById("cfg-port").value,
        shortcuts: document.getElementById("cfg-shortcuts").value,
        skip_dirs: document.getElementById("cfg-skip").value,
      });
      if (data.ok) {
        if (data.gutter) document.documentElement.style.setProperty("--gutter", data.gutter);
        setStatus(status, "Saved. Host/port need a restart.", "ok");
      } else {
        setStatus(status, data.error || "Save failed.", "err");
      }
    }
  }

  bindAiToggle();
  bindMemory();
  bindSelection();
  bindSettings();

  async function boot() {
    const promptsReady = loadPromptCatalog();
    try {
      const st = await fetch("/api/state", { cache: "no-store" });
      if (st.ok) {
        const state = await st.json();
        if (state && state.gutter) {
          document.documentElement.style.setProperty("--gutter", state.gutter);
        }
        const verEl = document.getElementById("app-version");
        if (verEl && state && state.version) {
          verEl.hidden = false;
          verEl.textContent = "v" + state.version;
        }
        if (!state.open) {
          location.replace("/");
          return;
        }
      }
      const res = await fetch("/api/notes", { cache: "no-store" });
      if (res.status === 409) {
        location.replace("/");
        return;
      }
      if (!res.ok) throw new Error("notes list failed");
      const data = await res.json();
      notes = data.notes || [];
      folderTitle = data.title || "Markdown";
      folderKey = data.path || folderTitle;
      defaultDoc = data.defaultDoc || (notes[0] && notes[0].path) || "";
      if (brandName) brandName.textContent = folderTitle;
      else brand.textContent = folderTitle;
      brand.setAttribute("href", "?doc=" + encodeURIComponent(defaultDoc));
      brand.addEventListener("click", function (ev) {
        if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return;
        ev.preventDefault();
        closeNav();
        loadDoc(defaultDoc, "", false);
      });
      renderNav();
    } catch (err) {
      article.innerHTML =
        '<div class="err"><p><strong>This page needs the local server.</strong></p>' +
        "<p>Run <code>python3 serve.py</code> and open <code>http://127.0.0.1:8765</code> to pick a folder.</p></div>";
      return;
    }
    try { await promptsReady; } catch (e) { /* catalog is optional */ }
    const r = routeFromLocation();
    const path = findNote(r.path) ? r.path : defaultDoc;
    if (!path) {
      article.innerHTML =
        '<div class="err"><p><strong>No markdown in this folder.</strong></p>' +
        '<p>Use <a href="/">Folders</a> to pick another.</p></div>';
      return;
    }
    await loadDoc(path, path === r.path ? r.hash : "", true);
  }

  boot();
})();
