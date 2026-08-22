(function () {
  "use strict";
  if (!window.CauseListActiveSearch) {
    const ACTIVE_MARK = "cpr-active-match";
    const MATCH_ROW = "cpr-row-match";
    const NONMATCH_ROW = "cpr-row-nonmatch";
    const MATCH_TABLE = "cpr-match-table";
    const FILTER_CLASS = "cpr-row-filter-active";
    const SEARCH_STYLE_ID = "cpr-active-search-style";
    const SEARCH_STYLE =
      "mark." + ACTIVE_MARK + "{padding:0 2px;color:#311006;background:#ffe08a;border-radius:3px;box-shadow:0 0 0 1px rgba(198,146,50,.32)}" +
      "html." + FILTER_CLASS + " table." + MATCH_TABLE + " tr." + NONMATCH_ROW + "{display:none!important}";
    const EXCLUDED_SELECTOR = [
      ".cpr-ribbon", ".page-ribbon", ".advanced-search-results",
      ".hidden", ".lookup-modal:not(.is-open)",
      "script", "style", "noscript", "template", "input", "textarea",
      "select", "option", "button", "[hidden]", "[aria-hidden=\"true\"]",
      "[contenteditable=\"true\"]", "#causeListSiblingManifest",
    ].join(",");
    const CHARACTER_MAP = {
      "ी":"ि", "ू":"ु", "ृ":"ि", "ऋ":"रि", "श":"स", "ष":"स",
      "ङ":"न", "ण":"न", "ञ":"न", "ं":"न्", "व":"ब",
      "०":"0", "१":"1", "२":"2", "३":"3", "४":"4",
      "५":"5", "६":"6", "७":"7", "८":"8", "९":"9",
    };

    function normalizeWithMap(value) {
      const source = String(value || "").normalize("NFC").toLocaleLowerCase();
      let text = "";
      const indexMap = [];
      for (let index = 0; index < source.length; index += 1) {
        const character = source[index];
        if (/\s/.test(character) || /[\u200B-\u200D\uFEFF]/.test(character)) continue;
        const mapped = CHARACTER_MAP[character] || character;
        for (const output of mapped) {
          text += output;
          indexMap.push(index);
        }
      }
      return {source, text, indexMap};
    }

    function findMatches(query, value, useNormalizer) {
      const source = String(value || "").normalize("NFC");
      if (!query || !source) return [];
      if (!useNormalizer) {
        const needle = String(query).normalize("NFC").toLocaleLowerCase();
        const haystack = source.toLocaleLowerCase();
        if (!needle) return [];
        const matches = [];
        let fromIndex = 0;
        while (fromIndex <= haystack.length) {
          const start = haystack.indexOf(needle, fromIndex);
          if (start < 0) break;
          matches.push({start, end:start + needle.length});
          fromIndex = start + Math.max(needle.length, 1);
        }
        return matches;
      }
      const normalizedQuery = normalizeWithMap(query).text;
      const normalizedSource = normalizeWithMap(source);
      if (!normalizedQuery) return [];
      const matches = [];
      let fromIndex = 0;
      while (fromIndex <= normalizedSource.text.length) {
        const index = normalizedSource.text.indexOf(normalizedQuery, fromIndex);
        if (index < 0) break;
        const endIndex = index + normalizedQuery.length - 1;
        matches.push({
          start: normalizedSource.indexMap[index],
          end: normalizedSource.indexMap[endIndex] + 1,
        });
        fromIndex = index + Math.max(normalizedQuery.length, 1);
      }
      return matches;
    }

    function createActivePageSearch(options) {
      const settings = options || {};
      const rootDocument = settings.document || document;
      const filterInput = settings.filterInput || null;
      const filterLabel = settings.filterLabel || (filterInput && filterInput.closest("label"));
      const onResults = typeof settings.onResults === "function" ? settings.onResults : null;
      const boundFrames = new WeakSet();
      let lastQuery = "";
      let lastNormalizer = true;
      let rerunQueued = false;

      function addSearchStyle(doc) {
        if (!doc || !doc.head || doc.getElementById(SEARCH_STYLE_ID)) return;
        const style = doc.createElement("style");
        style.id = SEARCH_STYLE_ID;
        style.textContent = SEARCH_STYLE;
        doc.head.appendChild(style);
      }

      function queueRerun() {
        if (!lastQuery || rerunQueued) return;
        rerunQueued = true;
        setTimeout(() => {
          rerunQueued = false;
          if (lastQuery) search(lastQuery, lastNormalizer, {scroll:false});
        }, 0);
      }

      function collectDocuments() {
        const documents = [];
        const seen = new Set();
        function visit(doc) {
          if (!doc || seen.has(doc)) return;
          seen.add(doc);
          documents.push(doc);
          Array.from(doc.querySelectorAll("iframe")).forEach((frame) => {
            if (frame.hidden || frame.closest('[hidden],[aria-hidden="true"]')) return;
            if (!boundFrames.has(frame)) {
              boundFrames.add(frame);
              frame.addEventListener("load", queueRerun);
            }
            try { visit(frame.contentDocument); } catch (error) {}
          });
        }
        visit(rootDocument);
        return documents;
      }

      function clearDocument(doc) {
        Array.from(doc.querySelectorAll("mark[data-cpr-active-match]")).forEach((mark) => {
          const parent = mark.parentNode;
          mark.replaceWith(doc.createTextNode(mark.textContent || ""));
          if (parent && typeof parent.normalize === "function") parent.normalize();
        });
        doc.querySelectorAll("." + MATCH_ROW).forEach((row) => row.classList.remove(MATCH_ROW));
        doc.querySelectorAll("." + NONMATCH_ROW).forEach((row) => row.classList.remove(NONMATCH_ROW));
        doc.querySelectorAll("." + MATCH_TABLE).forEach((table) => table.classList.remove(MATCH_TABLE));
        doc.documentElement.classList.remove(FILTER_CLASS);
      }

      function updateFilterControl(rowCount) {
        if (!filterInput) return;
        filterInput.disabled = rowCount < 1;
        if (rowCount < 1) filterInput.checked = false;
        if (filterLabel) filterLabel.hidden = rowCount < 1;
      }

      function setFilter(enabled) {
        const active = Boolean(enabled && filterInput && !filterInput.disabled);
        collectDocuments().forEach((doc) => doc.documentElement.classList.toggle(FILTER_CLASS, active));
      }

      function markTextNode(node, matches) {
        const doc = node.ownerDocument;
        const source = node.data;
        const fragment = doc.createDocumentFragment();
        let position = 0;
        matches.forEach((match) => {
          if (match.start > position) fragment.appendChild(doc.createTextNode(source.slice(position, match.start)));
          const mark = doc.createElement("mark");
          mark.className = ACTIVE_MARK;
          mark.dataset.cprActiveMatch = "";
          mark.textContent = source.slice(match.start, match.end);
          fragment.appendChild(mark);
          position = match.end;
        });
        if (position < source.length) fragment.appendChild(doc.createTextNode(source.slice(position)));
        node.replaceWith(fragment);
      }

      function isExcluded(element) {
        return !element || Boolean(element.closest(EXCLUDED_SELECTOR));
      }

      function search(query, useNormalizer, runOptions) {
        lastQuery = String(query || "").trim();
        lastNormalizer = useNormalizer !== false;
        const documents = collectDocuments();
        documents.forEach(clearDocument);
        if (!lastQuery) {
          updateFilterControl(0);
          const emptyStats = {matches:0, rows:0, documents:documents.length, firstMark:null};
          if (onResults) onResults(emptyStats);
          return emptyStats;
        }

        let matchCount = 0;
        let rowCount = 0;
        let firstMark = null;
        documents.forEach((doc) => {
          addSearchStyle(doc);
          const matchedTables = new Set();
          Array.from(doc.querySelectorAll("table tr")).forEach((row) => {
            if (isExcluded(row) || !row.querySelector("td")) return;
            if (findMatches(lastQuery, row.textContent || "", lastNormalizer).length) {
              row.classList.add(MATCH_ROW);
              const table = row.closest("table");
              if (table) matchedTables.add(table);
              rowCount += 1;
            }
          });
          matchedTables.forEach((table) => {
            table.classList.add(MATCH_TABLE);
            Array.from(table.querySelectorAll("tr")).forEach((row) => {
              if (row.querySelector("td") && !row.classList.contains(MATCH_ROW)) row.classList.add(NONMATCH_ROW);
            });
          });

          const view = doc.defaultView || window;
          const walker = doc.createTreeWalker(doc.body || doc.documentElement, view.NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
              if (!node.data || !node.data.trim() || isExcluded(node.parentElement)) return view.NodeFilter.FILTER_REJECT;
              return view.NodeFilter.FILTER_ACCEPT;
            },
          });
          const nodes = [];
          while (walker.nextNode()) nodes.push(walker.currentNode);
          nodes.forEach((node) => {
            const matches = findMatches(lastQuery, node.data, lastNormalizer);
            if (!matches.length) return;
            matchCount += matches.length;
            markTextNode(node, matches);
            if (!firstMark) firstMark = doc.querySelector("mark[data-cpr-active-match]");
          });
        });

        updateFilterControl(rowCount);
        setFilter(filterInput && filterInput.checked);
        const stats = {matches:matchCount, rows:rowCount, documents:documents.length, firstMark};
        if (onResults) onResults(stats);
        if ((!runOptions || runOptions.scroll !== false) && firstMark) {
          try {
            const frame = firstMark.ownerDocument.defaultView && firstMark.ownerDocument.defaultView.frameElement;
            if (frame) frame.scrollIntoView({behavior:"smooth", block:"center"});
            firstMark.scrollIntoView({behavior:"smooth", block:"center"});
          } catch (error) {}
        }
        return stats;
      }

      function clear() {
        lastQuery = "";
        collectDocuments().forEach(clearDocument);
        updateFilterControl(0);
      }

      if (filterInput) filterInput.addEventListener("change", () => setFilter(filterInput.checked));
      if (rootDocument.body && typeof MutationObserver === "function") {
        new MutationObserver((records) => {
          if (!lastQuery) return;
          const hasFrame = records.some((record) => Array.from(record.addedNodes).some((node) =>
            node.nodeType === 1 && (node.matches("iframe") || node.querySelector("iframe"))
          ));
          if (hasFrame) queueRerun();
        }).observe(rootDocument.body, {childList:true, subtree:true});
      }
      updateFilterControl(0);
      return {search, clear, setFilter};
    }

    window.CauseListActiveSearch = {create:createActivePageSearch, findMatches};
  }
  if (!window.CauseListSearchHistory) {
    const SEARCH_HISTORY_KEY = "cause-list-search-history-v1";

    function readSearchHistory() {
      try {
        const stored = JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) || "[]");
        return Array.isArray(stored)
          ? stored.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 3)
          : [];
      } catch (error) {
        return [];
      }
    }

    function saveSearchQuery(value) {
      const query = String(value || "").trim();
      if (!query) return readSearchHistory();
      const history = [query, ...readSearchHistory().filter((item) => item !== query)].slice(0, 3);
      try { localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history)); } catch (error) {}
      return history;
    }

    function attachSearchHistory(input, listId) {
      if (!input) return {add:saveSearchQuery, render:function () {}};
      let list = document.getElementById(listId);
      if (!list) {
        list = document.createElement("datalist");
        list.id = listId;
        (document.body || document.documentElement).appendChild(list);
      }
      input.setAttribute("list", listId);
      function render() {
        list.replaceChildren();
        readSearchHistory().forEach((query) => list.appendChild(new Option(query)));
      }
      function add(query) {
        const history = saveSearchQuery(query);
        list.replaceChildren();
        history.forEach((item) => list.appendChild(new Option(item)));
      }
      window.addEventListener("storage", (event) => {
        if (event.key === SEARCH_HISTORY_KEY) render();
      });
      render();
      return {add, render};
    }

    window.CauseListSearchHistory = {read:readSearchHistory, save:saveSearchQuery, attach:attachSearchHistory};
  }
  if (window.CauseListPersistentRibbon) return;
  const CACHE_KEY = "cause-list-auto-files-v1";
  const FALLBACK_FILES = ["index20830212.html", "index20830302.html", "index20830415.html"];
  const MONTH_NAMES = [
    "वैशाख", "जेठ", "असार", "साउन", "भदौ", "असोज",
    "कात्तिक", "मंसिर", "पुस", "माघ", "फागुन", "चैत",
  ];
  function nepali(value) {
    return String(value).replace(/\d/g, (digit) => "०१२३४५६७८९"[Number(digit)]);
  }
  function parsePage(value) {
    let name = String(value || "").split(/[?#]/)[0].split(/[\\/]/).pop() || "";
    try { name = decodeURIComponent(name); } catch (error) {}
    const match = name.match(/^index(\d{8})\.html?$/i);
    if (!match) return null;
    const key = match[1], month = Number(key.slice(4, 6)), day = Number(key.slice(6));
    if (month < 1 || month > 12 || day < 1 || day > 32) return null;
    return {
      key: key,
      month: key.slice(0, 6),
      href: "index" + key + ".html",
      label: nepali(key.slice(0, 4) + "।" + key.slice(4, 6) + "।" + key.slice(6)),
    };
  }
  function cachedFiles() {
    try {
      const value = JSON.parse(localStorage.getItem(CACHE_KEY) || "[]");
      return Array.isArray(value) ? value : [];
    } catch (error) {
      return [];
    }
  }
  async function manifestFiles() {
    if (!/^https?:$/.test(location.protocol)) return [];
    try {
      const url = new URL("cause-list-files.js", new URL(".", location.href));
      url.searchParams.set("v", String(Date.now()));
      const response = await fetch(url, { cache: "no-store" });
      const value = await response.json();
      return response.ok && Array.isArray(value) ? value : [];
    } catch (error) {
      return [];
    }
  }
  function uniquePages(values) {
    const pages = new Map();
    values.forEach((value) => {
      const page = parsePage(value && value.href ? value.href : value);
      if (page) pages.set(page.key, page);
    });
    return Array.from(pages.values()).sort((a, b) => a.key.localeCompare(b.key));
  }
  function monthLabel(key) {
    const number = Number(key.slice(4, 6));
    return nepali(key.slice(0, 4) + "।" + key.slice(4, 6)) +
      (MONTH_NAMES[number - 1] ? " — " + MONTH_NAMES[number - 1] : "");
  }
  function isEmbeddedUnderRibbonPage() {
    if (window.self === window.top) return false;
    try {
      let current = window;
      while (current !== current.top) {
        const parentWindow = current.parent;
        if (/(?:^|\/)month\.html?$/i.test(parentWindow.location.pathname)) return true;
        if (parentWindow.document.querySelector(".page-ribbon,#causePersistentRibbon")) return true;
        current = parentWindow;
      }
    } catch (error) {}
    return false;
  }
  function createRibbon() {
    if (isEmbeddedUnderRibbonPage()) return null;
    if (document.querySelector(".page-ribbon,#causePersistentRibbon")) return null;
    const nav = document.createElement("nav");
    nav.id = "causePersistentRibbon";
    nav.className = "cpr-ribbon";
    nav.setAttribute("aria-label", "स्थायी पेशी सूची खोज तथा navigation");
    nav.innerHTML =
      '<div class="cpr-inner"><form class="cpr-search" role="search">' +
      '<input type="search" name="search" autocomplete="off" placeholder="नाम, मुद्दा नं., पक्ष वा विषय खोज्नुहोस्…" aria-label="हालको सक्रिय webpage मा खोज्नुहोस्">' +
      '<span class="cpr-options"><label class="cpr-check" title="Nepali spelling variants मिलाएर खोज्छ"><input type="checkbox" name="normalizer" checked><span>Normalizer</span></label>' +
      '<label class="cpr-check" title="Attachment content मा smart search"><input type="checkbox" name="smart"><span>Smart</span></label>' +
      '<label class="cpr-check cpr-filter-check" hidden title="मिलेका table rows मात्र देखाउनुहोस्"><input type="checkbox" name="matched-rows" disabled><span>Matched rows</span></label></span>' +
      '<button type="submit">खोज्नुहोस्</button><span class="cpr-search-status" role="status" aria-live="polite"></span></form>' +
      '<div class="cpr-nav"><label for="cprMonth">महिना</label><select id="cprMonth"><option value="">खोजिँदैछ…</option></select>' +
      '<label for="cprDate">मिति</label><select id="cprDate" disabled><option value="">पहिला महिना रोज्नुहोस्</option></select></div>' +
      '<a class="cpr-link" href="index.html" title="मुख्य पृष्ठ">⌂ Main</a>' +
      '<a class="cpr-link" href="README.html" title="प्रयोग विधि">ⓘ Help</a>' +
      '<a class="cpr-link" href="https://shivaprasadacharya.github.io/adeshkdc/orders.html?normalizer=1&amp;smart=0&amp;highlight=1" target="_blank" rel="noopener noreferrer" title="आदेश सम्पादन site खोल्नुहोस्">⚖ आदेश सम्पादन</a>' +
      '<span class="cpr-current" aria-label="हालको पृष्ठ"></span></div>';
    document.body.insertBefore(nav, document.body.firstChild);
    return nav;
  }
  function initializeRibbon(nav, pages) {
    if (!nav) return;
    const form = nav.querySelector(".cpr-search"),
      search = form.querySelector('input[type="search"]'),
      normalizer = form.querySelector('[name="normalizer"]'),
      smart = form.querySelector('[name="smart"]'),
      filterRows = form.querySelector('[name="matched-rows"]'),
      filterLabel = filterRows.closest("label"),
      searchStatus = form.querySelector(".cpr-search-status"),
      monthSelect = nav.querySelector("#cprMonth"),
      dateSelect = nav.querySelector("#cprDate"),
      current = parsePage(location.pathname),
      params = new URLSearchParams(location.search);
    function currentSearchScope() {
      if (current) return current.key;
      const requestedMonth = String(params.get("month") || "").toLowerCase();
      if (requestedMonth === "all" || /^\d{6}$/.test(requestedMonth)) return requestedMonth;
      const embedded = Array.from(document.querySelectorAll("iframe[src]"))
        .map((frame) => parsePage(frame.getAttribute("src")))
        .filter(Boolean);
      if (!embedded.length) return "";
      const embeddedMonths = Array.from(new Set(embedded.map((page) => page.month)));
      return embeddedMonths.length === 1 ? embeddedMonths[0] : "all";
    }
    const searchHistory = window.CauseListSearchHistory.attach(search, "cprSearchHistory");
    search.value = params.get("search") || "";
    normalizer.checked = params.get("normalizer") !== "0";
    smart.checked = params.get("smart") === "1";
    nav.querySelector(".cpr-current").textContent = current ? current.label : document.title;
    const activeSearch = window.CauseListActiveSearch.create({
      document:document,
      filterInput:filterRows,
      filterLabel:filterLabel,
      onResults(stats) {
        searchStatus.textContent = stats.matches
          ? nepali(stats.matches) + " highlight" + (stats.rows ? " · " + nepali(stats.rows) + " rows" : "")
          : stats.rows ? nepali(stats.rows) + " matched rows" : "यो पृष्ठमा भेटिएन";
      },
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const query = search.value.trim();
      if (!query) {
        activeSearch.clear();
        searchStatus.textContent = "";
        search.focus();
        return;
      }
      searchHistory.add(query);
      if (!smart.checked) {
        activeSearch.search(query, normalizer.checked);
        return;
      }
      const target = new URL("index.html", new URL(".", location.href));
      target.searchParams.set("search", query);
      target.searchParams.set("normalizer", normalizer.checked ? "1" : "0");
      target.searchParams.set("smart", smart.checked ? "1" : "0");
      const scope = currentSearchScope();
      if (scope) target.searchParams.set("scope", scope);
      location.href = target.href;
    });
    search.addEventListener("input", () => {
      if (search.value) return;
      activeSearch.clear();
      searchStatus.textContent = "";
    });
    normalizer.addEventListener("change", () => {
      if (!smart.checked && search.value.trim()) activeSearch.search(search.value.trim(), normalizer.checked);
    });
    smart.addEventListener("change", () => {
      search.placeholder = smart.checked
        ? "Attachment को content खोज्नुहोस्…"
        : "नाम, मुद्दा नं., पक्ष वा विषय खोज्नुहोस्…";
      if (smart.checked) {
        activeSearch.clear();
        searchStatus.textContent = "";
      } else if (search.value.trim()) {
        activeSearch.search(search.value.trim(), normalizer.checked);
      }
    });
    if (search.value && !smart.checked) activeSearch.search(search.value, normalizer.checked, {scroll:false});
    const months = Array.from(new Set(pages.map((page) => page.month))).sort();
    monthSelect.replaceChildren(new Option("महिना रोज्नुहोस्", ""));
    if (months.length) monthSelect.add(new Option("ALL — सबै उपलब्ध मिति", "all"));
    months.forEach((month) => monthSelect.add(new Option(monthLabel(month), month)));
    monthSelect.disabled = !months.length;
    function updateDates() {
      const month = monthSelect.value;
      dateSelect.replaceChildren(new Option(month ? "मिति रोज्नुहोस्" : "पहिला महिना रोज्नुहोस्", ""));
      if (month) {
        const monthPages = month === "all" ? pages : pages.filter((page) => page.month === month);
        const fileList = monthPages.map((page) => page.href).join(",");
        const allLabel = month === "all" ? "ALL — सबै उपलब्ध पेशी सूची" : "ALL — सबै मिति";
        dateSelect.add(new Option(allLabel, "month.html?month=" + month + "&files=" + encodeURIComponent(fileList)));
        monthPages.forEach((page) => dateSelect.add(new Option(page.label, page.href)));
      }
      dateSelect.disabled = !month;
    }
    monthSelect.addEventListener("change", () => {
      updateDates();
      if (monthSelect.value === "all" && dateSelect.options[1]) location.href = dateSelect.options[1].value;
    });
    dateSelect.addEventListener("change", () => {
      if (dateSelect.value) location.href = dateSelect.value;
    });
    const requestedMonth = current ? current.month : String(params.get("month") || "").toLowerCase();
    if (requestedMonth === "all" || months.includes(requestedMonth)) {
      monthSelect.value = requestedMonth;
      updateDates();
      if (current) dateSelect.value = current.href;
    }
  }
  async function init() {
    const nav = createRibbon();
    if (!nav) return;
    const pages = uniquePages([...FALLBACK_FILES, ...cachedFiles(), ...await manifestFiles()]);
    initializeRibbon(nav, pages);
  }
  window.CauseListPersistentRibbon = { init: init };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
