// Gaze probe (injected into proxied foreign pages by the harness).
// Plain JS, no imports. Runs INSIDE the project's own page and reports out:
// - click capture -> parent.postMessage({type:"preview-frame", x, y, frame})
// - window.__gazeProbe.queryElementAt(x, y) -> GazeFrame (same shape the
//   harness stub returns for demo, so Dev B consumes both identically).
// filePath is ALWAYS null here: foreign pages carry no data-source stamps.
// The harness resolves componentName -> file server-side (hybrid finder).
// JSON-safe output only: no DOM nodes, functions, or Maps cross the boundary.

(function () {
  "use strict";

  var SNAP_TAGS = {
    DIV: 1, SECTION: 1, ARTICLE: 1, HEADER: 1, FOOTER: 1, NAV: 1, MAIN: 1,
    ASIDE: 1, FORM: 1, BUTTON: 1, A: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1,
    H6: 1, P: 1, LI: 1, UL: 1, OL: 1, IMG: 1, VIDEO: 1, INPUT: 1,
    TEXTAREA: 1, SELECT: 1, LABEL: 1, SPAN: 1,
  };

  var MAX_CANDIDATES = 5;
  var SNIPPET_MAX = 2048;

  function isVisible(el) {
    try {
      var r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      var s = window.getComputedStyle(el);
      return s.display !== "none" && s.visibility !== "hidden" && parseFloat(s.opacity || "1") > 0;
    } catch (e) {
      return false;
    }
  }

  function ignored(el) {
    // PM overlay layer (agreed attribute) + non-rendered elements.
    if (el.closest && el.closest("[data-gaze-overlay]")) return true;
    var t = el.tagName;
    return t === "SCRIPT" || t === "STYLE" || t === "HEAD" || t === "HTML" || t === "BODY";
  }

  function snapUp(el) {
    var node = el;
    while (node && node !== document.body) {
      if (node.nodeType === 1 && !ignored(node)) {
        if (SNAP_TAGS[node.tagName]) return node;
        // Block-level fallback: an element holding text with no snappable kid.
        try {
          var d = window.getComputedStyle(node).display;
          if ((d === "block" || d === "flex" || d === "grid") && node.children.length === 0) {
            return node;
          }
        } catch (e) { /* fall through */ }
      }
      node = node.parentElement;
    }
    return null;
  }

  function fiberName(el) {
    try {
      var key = null;
      for (var k in el) {
        if (k.indexOf("__reactFiber$") === 0 || k.indexOf("__reactInternalInstance$") === 0) {
          key = k;
          break;
        }
      }
      if (!key) return null;
      var f = el[key];
      var seen = 0;
      while (f && seen < 25) {
        seen += 1;
        var type = f.elementType || f.type;
        if (type && typeof type !== "string") {
          var name = type.displayName || type.name;
          if (typeof name === "string" && name.length > 0 && name !== "Fragment" && name !== "StrictMode") {
            return name.slice(0, 80);
          }
        }
        f = f.return;
      }
    } catch (e) { /* non-React DOM or minified internals */ }
    return null;
  }

  function cheapSelector(el) {
    try {
      var t = el.tagName.toLowerCase();
      if (el.id) return "#" + String(el.id).slice(0, 60);
      var cls = (el.className && el.className.baseVal !== undefined ? "" : String(el.className || ""))
        .split(/\s+/).filter(Boolean).slice(0, 2).join(".");
      return cls ? t + "." + cls.slice(0, 80) : t;
    } catch (e) {
      return "el";
    }
  }

  function supportedOps(el) {
    var t = el.tagName;
    if (t === "IMG" || t === "VIDEO") return [{ op: "hide", param: null }];
    if (t === "BUTTON" || t === "A" || t === "INPUT") {
      var ops = [
        { op: "set-color", param: "brand" },
        { op: "set-radius", param: "full" },
      ];
      if (t !== "INPUT") {
        var txt = (el.textContent || "").trim().slice(0, 80);
        if (txt) ops.push({ op: "swap-text", param: txt });
      }
      return ops;
    }
    var out = [{ op: "set-color", param: "brand" }];
    var text = (el.textContent || "").trim();
    if (text && text.length < 300) out.push({ op: "swap-text", param: text.slice(0, 80) });
    else out.push({ op: "hide", param: null });
    return out;
  }

  function toCandidate(el, i) {
    var r = el.getBoundingClientRect();
    var html = "";
    try {
      html = el.outerHTML || "";
    } catch (e) { /* cross-shadow edge */ }
    var truncated = html.length > SNIPPET_MAX;
    // Surrounding markup (parent chain, one level): lets the file picker
    // prefer the file containing THIS instance when identical text appears
    // in several files. Page-adjacent input — server slices + never trusts.
    var context = "";
    try {
      var p = el.parentElement;
      if (p && p !== document.body) context = (p.outerHTML || "").slice(0, 1200);
    } catch (e) { /* detached */ }
    return {
      id: "c" + i,
      selector: cheapSelector(el),
      componentName: fiberName(el),
      filePath: null,
      boundingRect: {
        x: Math.round(r.x), y: Math.round(r.y),
        width: Math.round(r.width), height: Math.round(r.height),
      },
      outerHTMLSnippet: html.slice(0, SNIPPET_MAX),
      htmlTruncated: truncated,
      contextHTML: context,
      confidence: 0.85,
      trackedConfidence: 0.9,
      supportedOps: supportedOps(el),
      screenshotCrop: null,
      sourceLine: null,
    };
  }

  function queryElementAt(x, y) {
    var hits = [];
    try {
      hits = document.elementsFromPoint(x, y) || [];
    } catch (e) {
      hits = [];
    }
    var seen = [];
    var cands = [];
    for (var i = 0; i < hits.length && cands.length < MAX_CANDIDATES; i++) {
      var snapped = snapUp(hits[i]);
      if (!snapped) continue;
      // Identity dedupe by scan (n is tiny). NOTE: never key an object by
      // the node — every div stringifies to the same key.
      var dup = false;
      for (var d = 0; d < seen.length; d++) {
        if (seen[d] === snapped) { dup = true; break; }
      }
      if (dup) continue;
      seen.push(snapped);
      if (!isVisible(snapped)) continue;
      cands.push(snapped);
    }
    // Deterministic document order (never confidence order — ordering is
    // part of the decision input).
    cands.sort(function (a, b) {
      if (a === b) return 0;
      var pos = a.compareDocumentPosition(b);
      // DOCUMENT_POSITION_FOLLOWING = 4: a precedes b.
      return (pos & 4) ? -1 : 1;
    });
    var out = [];
    for (var j = 0; j < cands.length; j++) out.push(toCandidate(cands[j], j));
    // Deepest containing candidate wins lock-on (parents contain children,
    // so the last DOM-order match is the most specific).
    var locked = null;
    for (var m = out.length - 1; m >= 0; m--) {
      var r = out[m].boundingRect;
      if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) {
        locked = out[m];
        break;
      }
    }
    return { candidates: out, lockedTarget: locked, capturedAt: Date.now() };
  }

  // Click capture: the workspace learns WHAT was hit at click time (component
  // name + file candidates come later server-side). Capture phase so app
  // handlers calling stopPropagation can't swallow the report.
  document.addEventListener(
    "click",
    function (e) {
      var frame;
      try {
        frame = queryElementAt(e.clientX, e.clientY);
      } catch (err) {
        frame = { candidates: [], lockedTarget: null, capturedAt: Date.now() };
      }
      try {
        parent.postMessage({ type: "preview-frame", x: e.clientX, y: e.clientY, frame: frame }, "*");
      } catch (err) { /* detached frame */ }
    },
    true,
  );

  window.__gazeProbe = { queryElementAt: queryElementAt };
})();
