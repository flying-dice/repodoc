/* RepoDoc kanban board webview — plain browser ES2020, no build step. */
(function () {
  'use strict';

  var vscode = acquireVsCodeApi();

  /* ---- Local UI state (survives data re-renders) ---- */
  var state = {
    data: null, // { boardId, board, config, boardPath, capabilities, cardFiles, ... }
    query: '',
    addingCol: null, // column id currently showing the composer
    openCardId: null,
    // {cardId, toColumn, results:[MoveBlockedGate], overriding} — the guided
    // blocked-move dialog. Kept across data refreshes so a human can tick two
    // gates in a row; cleared only by Move / Cancel.
    blocked: null,
    lastMove: null, // {cardId, toColumn, index} of the most recent move attempt (for override retry)
    editingTitle: false, // card modal: the title is a text input
    editingDesc: false, // card modal: the description is a textarea
    addingCheck: false, // card modal: the checklist composer is open
    showAllGates: false, // card modal: show every transition, not just this one
    openGateHow: {}, // "<colId>:<dir>:<gateId>" -> "How to satisfy" is expanded
    dismissedPrompts: {}, // "<cardId>|<colId>" -> the column prompt is dismissed
  };

  // Bottom of the target column — the CLI's default move index.
  var MOVE_TO_END = Number.MAX_SAFE_INTEGER;

  var addText = ''; // uncontrolled composer text; never triggers a render
  // Unsent comment drafts, keyed "<boardId>/<cardId>" — a draft belongs to the
  // card it was typed on, so closing a card keeps it and opening another card
  // never inherits it. Mirrors src/panels/commentDrafts.ts BY HAND.
  var commentDrafts = {};
  var commentWho = null; // composer author override; null = use the configured name
  // Unsaved scenario edits, keyed "<boardId>/<cardId>/<index>" (or ".../new").
  // They live here, not in the DOM, so a data refresh — which rebuilds the whole
  // modal — cannot swallow what someone is halfway through typing. Mirrors
  // src/panels/scenarioDrafts.ts BY HAND.
  var scenarioDrafts = {};
  var scenarioPending = {}; // key -> {cardId, index, name, steps} posted, awaiting the file
  var lastPosted = {}; // key -> the same, kept so a late write is still recognised
  var scenarioSaved = {}; // key -> true while the "Saved" mark shows
  var scenarioFailed = {}; // key -> true when a save never reached the file
  var scenarioError = {}; // key -> inline validation message
  var confirmRemoveKey = null; // the block asking "Remove this scenario?"
  var focusScenario = null; // id of a scenario field to focus after the next render
  var descText = ''; // uncontrolled description-editor text
  var checkText = ''; // uncontrolled checklist-composer text
  var gatePassText = {}; // "<cardId>|<gateId>" -> uncontrolled evidence input text
  var overrideReason = ''; // uncontrolled override-reason text

  // Column prompts a human has dismissed live in webview state only — never on
  // disk (the prompt belongs to the board's process, not to one reader).
  try {
    var saved = vscode.getState();
    if (saved?.dismissedPrompts) {
      state.dismissedPrompts = saved.dismissedPrompts;
    }
  } catch (_stateErr) {
    /* ignore */
  }
  function persistDismissed() {
    try {
      vscode.setState({ dismissedPrompts: state.dismissedPrompts });
    } catch (_err) {
      /* ignore */
    }
  }

  /* ---- Comment drafts (mirrors src/panels/commentDrafts.ts) ---- */
  function draftKey(boardId, cardId) {
    return `${boardId}/${cardId}`;
  }
  function getDraft(drafts, boardId, cardId) {
    var value = drafts[draftKey(boardId, cardId)];
    return typeof value === 'string' ? value : '';
  }
  function setDraft(drafts, boardId, cardId, text) {
    if (text.trim() === '') {
      return clearDraft(drafts, boardId, cardId);
    }
    var next = Object.assign({}, drafts);
    next[draftKey(boardId, cardId)] = text;
    return next;
  }
  function clearDraft(drafts, boardId, cardId) {
    var key = draftKey(boardId, cardId);
    if (!Object.prototype.hasOwnProperty.call(drafts, key)) {
      return drafts;
    }
    var next = Object.assign({}, drafts);
    delete next[key];
    return next;
  }
  // The board this webview is showing; part of every draft key.
  function boardIdOf() {
    return state.data ? state.data.boardId : '';
  }

  /* ---- Scenario drafts (mirrors src/panels/scenarioDrafts.ts) ---- */
  var NEW_SCENARIO = 'new';
  function scenarioDraftKey(boardId, cardId, index) {
    return `${boardId}/${cardId}/${index}`;
  }
  function getScenarioDraft(drafts, key) {
    return Object.prototype.hasOwnProperty.call(drafts, key) ? drafts[key] : undefined;
  }
  function setScenarioDraft(drafts, key, draft) {
    var next = Object.assign({}, drafts);
    next[key] = draft;
    return next;
  }
  function clearScenarioDraft(drafts, key) {
    if (!Object.prototype.hasOwnProperty.call(drafts, key)) {
      return drafts;
    }
    var next = Object.assign({}, drafts);
    delete next[key];
    return next;
  }
  function clearCardDrafts(drafts, boardId, cardId) {
    var prefix = `${boardId}/${cardId}/`;
    var next = {};
    Object.keys(drafts).forEach(function (key) {
      if (key.indexOf(prefix) !== 0) {
        next[key] = drafts[key];
      }
    });
    return next;
  }
  function splitSteps(text) {
    var lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    while (lines.length > 0 && lines[0].trim() === '') {
      lines.shift();
    }
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
      lines.pop();
    }
    return lines;
  }
  function joinSteps(steps) {
    return (steps || []).join('\n');
  }
  function scenarioChangedUnderDraft(draft, stored) {
    if (!stored) {
      return true;
    }
    return draft.base.name !== stored.name || draft.base.steps !== joinSteps(stored.steps);
  }
  function draftMatchesStored(draft, stored) {
    if (!stored) {
      return false;
    }
    return (
      draft.name.replace(/\s+/g, ' ').trim() === stored.name &&
      joinSteps(splitSteps(draft.steps)) === joinSteps(stored.steps)
    );
  }
  /* ---- end of the scenario-draft mirror ---- */

  /* ---- Drag state ---- */
  var drag = {
    active: false,
    cardId: null,
    el: null, // the dragged card DOM node
    placeholder: null,
    pendingData: null, // data received mid-drag, applied on dragend
  };

  /* ---- Inline SVG icons (from the design mock) ---- */
  var ICON = {
    copy: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path></svg>',
    search:
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.2-3.2"></path></svg>',
    checklist:
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"></path><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>',
    comment:
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>',
    check:
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>',
    shield:
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>',
    file: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path></svg>',
  };

  /* ---- Priority mappings (single source of truth) ---- */
  // Priority accents are UI chrome, so they follow the theme's chart colours
  // (red/amber for high/med, muted foreground for low). Each entry pairs the
  // `--vscode-*` token.
  var PRIORITY_VARS = {
    high: { token: '--vscode-charts-red' },
    med: { token: '--vscode-charts-yellow' },
    low: { token: '--vscode-descriptionForeground' },
    // D-1: an unset priority is "None", not a silent "Medium".
    none: { token: '--vscode-descriptionForeground' },
  };
  var PRIORITY_LABELS = { high: 'High', med: 'Medium', low: 'Low', none: 'None' };
  var PRIORITY_OPTIONS = [
    { value: '', label: 'None' },
    { value: 'low', label: 'Low' },
    { value: 'med', label: 'Medium' },
    { value: 'high', label: 'High' },
  ];

  /* ---- Helpers ---- */
  var EVT = {
    onClick: 'click',
    onInput: 'input',
    onChange: 'change',
    onKeyDown: 'keydown',
    onDragStart: 'dragstart',
    onDragEnd: 'dragend',
    onDragOver: 'dragover',
    onDrop: 'drop',
    onMouseDown: 'mousedown',
    onWheel: 'wheel',
    onScroll: 'scroll',
    onBlur: 'blur',
  };

  /**
   * Tiny DOM builder. props: {class, style, title, draggable, html, dataset, on*}.
   * Children are appended as text nodes (safe) or existing nodes.
   */
  function h(tag, props, children) {
    var node = document.createElement(tag);
    if (props) {
      for (var key in props) {
        if (!Object.prototype.hasOwnProperty.call(props, key)) {
          continue;
        }
        var val = props[key];
        if (val == null) {
          continue;
        }
        if (key === 'class') {
          node.className = val;
        } else if (key === 'style') {
          node.setAttribute('style', val);
        } else if (key === 'html') {
          node.innerHTML = val; // static SVGs + host-rendered markdown (CSP blocks scripts)
        } else if (key === 'dataset') {
          for (var dk in val) {
            if (Object.prototype.hasOwnProperty.call(val, dk)) {
              node.dataset[dk] = val[dk];
            }
          }
        } else if (key === 'draggable') {
          node.draggable = !!val;
        } else if (EVT[key]) {
          node.addEventListener(EVT[key], val);
        } else {
          node.setAttribute(key, val);
        }
      }
    }
    if (children != null) {
      appendChildren(node, children);
    }
    return node;
  }

  function appendChildren(node, children) {
    if (Array.isArray(children)) {
      for (var i = 0; i < children.length; i++) {
        appendChildren(node, children[i]);
      }
    } else if (children instanceof Node) {
      node.appendChild(children);
    } else if (children != null && children !== false) {
      node.appendChild(document.createTextNode(String(children)));
    }
  }

  function icon(markup, className) {
    return h('span', { class: className || 'icon', html: markup });
  }

  function humanizeTime(iso) {
    if (!iso) {
      return '';
    }
    var then = Date.parse(iso);
    if (isNaN(then)) {
      return String(iso);
    }
    var secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
    if (secs < 60) {
      return 'just now';
    }
    var mins = Math.floor(secs / 60);
    if (mins < 60) {
      return `${mins}m`;
    }
    var hours = Math.floor(mins / 60);
    if (hours < 24) {
      return `${hours}h`;
    }
    var days = Math.floor(hours / 24);
    if (days < 7) {
      return `${days}d`;
    }
    return `${Math.floor(days / 7)}w`;
  }

  // Tinted chip/pill style: solid text, translucent fill + border in the same hue.
  // Used for DATA colours (labels) supplied verbatim from the board .config.json,
  // so the 22/44 hex-alpha suffixes are applied to the literal colour.
  function tintStyle(color) {
    return `color:${color};background:${color}22;border:1px solid ${color}44;`;
  }

  // Theme-aware equivalent of tintStyle for CHROME accents that resolve from a
  // `--vscode-*` token. color-mix reproduces the 0x22 (~13%) fill and 0x44
  // (~27%) border alphas against the resolved variable.
  function tintVar(token) {
    var c = `var(${token})`;
    return (
      'color:' +
      c +
      ';background:color-mix(in srgb, ' +
      c +
      ' 13%, transparent);border:1px solid color-mix(in srgb, ' +
      c +
      ' 27%, transparent);'
    );
  }

  // Derived identity for a free-text agent value: initials + a stable color
  // from a string hash. No roster — whoever writes agent: renders.
  function agentAvatar(name) {
    var words = String(name).trim().split(/\s+/).slice(0, 2);
    var initials =
      words
        .map(function (w) {
          return w.charAt(0);
        })
        .join('')
        .toUpperCase() || '?';
    var hash = 0;
    for (var i = 0; i < name.length; i++) {
      hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    }
    return { initials: initials, color: `hsl(${hash % 360}, 45%, 45%)` };
  }

  function matches(card) {
    var q = state.query.trim().toLowerCase();
    if (q && card.title.toLowerCase().indexOf(q) === -1) {
      return false;
    }
    return true;
  }

  function board() {
    return state.data ? state.data.board : null;
  }
  function config() {
    return state.data ? state.data.config : { labels: {}, fields: [] };
  }
  // What this surface supports (see BoardCapabilities in panels/protocol.ts).
  // A feature set has no comments, fields, checklists, or column editing.
  function can(name) {
    var caps = state.data?.capabilities;
    return caps?.[name] !== false;
  }
  /**
   * A feature set is the surface whose cards carry Gherkin scenarios. It DOES
   * declare `meta` (a feature's title is its `Feature:` line and is editable),
   * so the flag that tells the two surfaces apart is `scenarios` — the one
   * thing only a feature set has.
   */
  function isFeatureSet() {
    return state.data?.capabilities?.scenarios === true;
  }
  function noun(plural) {
    if (isFeatureSet()) {
      return plural ? 'features' : 'feature';
    }
    return plural ? 'cards' : 'card';
  }
  // Cards on the board, and how many of them the current filter keeps.
  function cardCounts() {
    var b = board();
    var total = 0;
    var visible = 0;
    (b?.columns || []).forEach(function (col) {
      (col.cardIds || []).forEach(function (id) {
        var card = b.cards[id];
        if (!card) {
          return;
        }
        total++;
        if (matches(card)) {
          visible++;
        }
      });
    });
    return { visible: visible, total: total };
  }
  function clearFilter() {
    state.query = '';
    render();
    var input = document.getElementById('search-input');
    if (input) {
      input.focus();
    }
  }
  function fieldDefs() {
    var f = config().fields;
    return Array.isArray(f) ? f : [];
  }
  function fieldDefById(fieldId) {
    var defs = fieldDefs();
    for (var i = 0; i < defs.length; i++) {
      if (defs[i].id === fieldId) {
        return defs[i];
      }
    }
    return null;
  }
  // The skill's human sign-off heuristic (skillContent.ts): an agent must not
  // set these for someone else, so the UI says the same thing to a human.
  function isSignOffField(fieldId) {
    return /(^|[-_])(approv|review|sign-?off)/i.test(String(fieldId || ''));
  }
  function isFiltering() {
    return state.query.trim() !== '';
  }
  function copyText(text) {
    try {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(String(text));
      }
    } catch (_err) {
      /* clipboard unavailable — the command is still selectable text */
    }
  }
  function titleCase(id) {
    return String(id == null ? '' : id)
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, function (c) {
        return c.toUpperCase();
      });
  }
  function fieldLabel(def) {
    return def.label || titleCase(def.id);
  }
  function gateLabel(def) {
    return def.label || def.id;
  }

  // First done `## Gates` evidence line for a gate id (null when absent).
  function gateEvidence(card, gateId) {
    var gates = card.gates || [];
    for (var i = 0; i < gates.length; i++) {
      if (gates[i].gateId === gateId && gates[i].done) {
        return gates[i];
      }
    }
    return null;
  }

  // Resolve a gate's target field value: board custom fields first, then the
  // reserved card keys (e.g. `priority`, `status`) for reserved-id gates.
  function fieldValue(card, fieldId) {
    var custom = card.custom || {};
    if (Object.prototype.hasOwnProperty.call(custom, fieldId)) {
      return custom[fieldId];
    }
    return card[fieldId];
  }

  // A value is "present" when non-null, non-blank, and (for arrays) non-empty.
  function isPresent(value) {
    if (value == null) {
      return false;
    }
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    return String(value).trim() !== '';
  }

  // Strip a single layer of matching single/double quotes from a literal.
  function unquote(s) {
    var t = String(s == null ? '' : s).trim();
    if (t.length >= 2) {
      var f = t.charAt(0);
      var l = t.charAt(t.length - 1);
      if ((f === '"' && l === '"') || (f === "'" && l === "'")) {
        return t.slice(1, -1);
      }
    }
    return t;
  }

  // Client mirror of the core field-check mini-syntax. Supported checks:
  //   absent | 'nonempty' → present ; 'empty' → not present ;
  //   '= v' / '!= v' (arrays: exactly-one-element equality) ;
  //   '> n' '>= n' '< n' '<= n' (numeric, parseFloat) ;
  //   'contains v' (case-insensitive substring / array membership) ;
  //   'match <regex>' (any array element; invalid regex → false).
  function checkValue(value, check) {
    // Mirrors src/core/gates.ts checkValue EXACTLY — any change must be made
    // in both places.
    var expr = String(check == null ? '' : check).trim();
    var lower = expr.toLowerCase();
    if (expr === '' || lower === 'nonempty') {
      return isPresent(value);
    }
    if (lower === 'empty') {
      return !isPresent(value);
    }
    var m;
    if ((m = /^(contains|match)\b([\s\S]*)$/i.exec(expr))) {
      var operand = unquote(m[2].trim());
      if (m[1].toLowerCase() === 'contains') {
        var needle = operand.toLowerCase();
        if (Array.isArray(value)) {
          return value.some(function (x) {
            return String(x).toLowerCase() === needle;
          });
        }
        if (value === undefined || value === null) {
          return false;
        }
        return String(value).toLowerCase().indexOf(needle) !== -1;
      }
      var re;
      try {
        re = new RegExp(operand);
      } catch (_err) {
        return false;
      }
      if (Array.isArray(value)) {
        return value.some(function (x) {
          return re.test(String(x));
        });
      }
      if (value === undefined || value === null) {
        return false;
      }
      return re.test(String(value));
    }
    if ((m = /^(!=|>=|<=|=|>|<)([\s\S]*)$/.exec(expr))) {
      var op = m[1];
      var target = unquote(m[2].trim());
      if (op === '=' || op === '!=') {
        var eq;
        if (Array.isArray(value)) {
          eq = value.length === 1 && String(value[0]) === target;
        } else {
          eq = value !== undefined && value !== null && String(value) === target;
        }
        return op === '=' ? eq : !eq;
      }
      var joined =
        value === undefined || value === null
          ? ''
          : Array.isArray(value)
            ? value.join(',')
            : String(value);
      var a = parseFloat(joined);
      var b = parseFloat(target);
      if (isNaN(a) || isNaN(b)) {
        return false;
      }
      switch (op) {
        case '>':
          return a > b;
        case '>=':
          return a >= b;
        case '<':
          return a < b;
        case '<=':
          return a <= b;
      }
    }
    return false;
  }

  // Pure client-side mirror of the core gate semantics: does this card satisfy
  // the given gate right now? (Used for the card-face shield chips and modal
  // icons; the host re-evaluates authoritatively on move.)
  //  - field gate: evaluate the (custom/reserved) field against def.check;
  //  - script gate: satisfied by a done `## Gates` evidence line for the id.
  function gateSatisfied(card, def) {
    if (def.field) {
      return checkValue(fieldValue(card, def.field), def.check);
    }
    if (def.script) {
      return !!gateEvidence(card, def.id);
    }
    return false;
  }

  // Human display name for a field id (board label, else title-cased id).
  function fieldDisplayName(fieldId) {
    var defs = fieldDefs();
    for (var i = 0; i < defs.length; i++) {
      if (defs[i].id === fieldId) {
        return fieldLabel(defs[i]);
      }
    }
    return titleCase(fieldId);
  }

  // Readable phrasing of a field check for gate notes.
  function describeCheck(check) {
    var expr = String(check == null ? '' : check).trim();
    if (expr === '' || expr === 'nonempty') {
      return 'to be set';
    }
    if (expr === 'empty') {
      return 'to be empty';
    }
    return expr;
  }
  function labelDef(key) {
    var labels = config().labels || {};
    return key && labels[key] ? labels[key] : null;
  }

  function subtaskProgress(card) {
    if (!card.checklist?.length) {
      return null;
    }
    var done = 0;
    for (var i = 0; i < card.checklist.length; i++) {
      if (card.checklist[i].done) {
        done++;
      }
    }
    return { done: done, total: card.checklist.length };
  }

  /* ---- Top bar ---- */
  function buildTopBar() {
    var b = board();

    var crumb = h('div', { class: 'crumb' }, [
      h('span', { class: 'crumb-section' }, 'Boards'),
      h('span', { class: 'crumb-sep' }, '/'),
      h('span', { class: 'crumb-leaf' }, b ? b.name : ''),
    ]);

    var searchInput = h('input', {
      id: 'search-input',
      placeholder: `Search ${noun(true)}`,
      value: state.query,
      onInput: function (e) {
        state.query = e.target.value;
        render();
      },
    });
    var search = h('div', { class: 'search' }, [icon(ICON.search), searchInput]);

    var right = h('div', { class: 'topbar-right' }, [search]);

    return h('div', { class: 'topbar' }, [crumb, h('div', { class: 'topbar-spacer' }), right]);
  }

  /* ---- Label chip ---- */
  function labelChip(key) {
    var l = labelDef(key);
    if (!l) {
      return null;
    }
    return h('span', { class: 'label-chip', style: tintStyle(l.color) }, l.name);
  }

  // Small muted chip for a showOnCard field value (null when nothing to show).
  function showOnCardChip(def, card) {
    var val = card.custom?.[def.id];
    if (val == null || val === '' || (Array.isArray(val) && !val.length)) {
      return null;
    }
    if (def.type === 'boolean') {
      // Boolean renders just the label when true; nothing when false.
      return val ? h('span', { class: 'field-chip' }, fieldLabel(def)) : null;
    }
    var shown = Array.isArray(val) ? val.join(', ') : String(val);
    return h('span', { class: 'field-chip' }, `${fieldLabel(def)}: ${shown}`);
  }

  // Shield chip counting satisfied/total exit gates for the card's column.
  function exitGateChip(card, col) {
    if (!col?.exit?.length) {
      return null;
    }
    var total = col.exit.length;
    var sat = 0;
    var labels = [];
    col.exit.forEach(function (def) {
      var ok = gateSatisfied(card, def);
      if (ok) {
        sat++;
      }
      labels.push((ok ? '✓ ' : '○ ') + gateLabel(def));
    });
    return h(
      'span',
      {
        class: `gate-chip${sat >= total ? ' ok' : ''}`,
        title: `Exit gates\n${labels.join('\n')}`,
      },
      [icon(ICON.shield, 'icon'), `${sat}/${total}`],
    );
  }

  /* ---- Card ---- */
  function buildCard(cardId, card, col) {
    var children = [];

    if (card.labels?.length) {
      var chips = card.labels.map(labelChip).filter(Boolean);
      if (chips.length) {
        children.push(h('div', { class: 'card-labels' }, chips));
      }
    }

    var titleRow = [];
    if (card.priority === 'high' || card.priority === 'med') {
      var pv = PRIORITY_VARS[card.priority];
      var pColor = `var(${pv.token})`;
      var pGlowAlpha = card.priority === 'high' ? '18%' : '16%';
      var pGlow = `color-mix(in srgb, ${pColor} ${pGlowAlpha}, transparent)`;
      titleRow.push(
        h('span', {
          class: 'priority-dot',
          title: 'Priority',
          style: `background:${pColor};box-shadow:0 0 0 3px ${pGlow};`,
        }),
      );
    }
    titleRow.push(h('div', { class: 'card-title' }, card.title));
    children.push(h('div', { class: 'card-titlerow' }, titleRow));
    // The id is what every CLI command and chat message references — always
    // visible, with a one-click copy of the full ref.
    children.push(
      h('div', { class: 'card-idrow' }, [
        h('code', { class: 'card-id', title: 'Card id' }, card.id),
        h(
          'button',
          {
            class: 'card-copy',
            title: 'Copy ref',
            'aria-label': `Copy ref for ${card.id}`,
            onClick: function (e) {
              e.stopPropagation();
              copyRef(card.id);
            },
          },
          icon(ICON.copy, 'icon'),
        ),
      ]),
    );

    if (card.live) {
      // D-8: an unset progress is not "0% complete" — omit the number and the
      // bar entirely rather than implying no work has been done.
      var hasPct = typeof card.progress === 'number' && Number.isFinite(card.progress);
      var pct = `${hasPct ? card.progress : 0}%`;
      children.push(
        h('div', { class: 'live-block' }, [
          h('div', { class: 'live-row' }, [
            h('span', { class: 'live-dot' }),
            h('span', { class: 'live-status' }, card.status || ''),
            hasPct ? h('span', { class: 'live-pct' }, pct) : null,
          ]),
          hasPct
            ? h('div', { class: 'progress-track' }, [
                h('div', { class: 'progress-fill', style: `width:${pct};` }),
              ])
            : null,
        ]),
      );
    }

    var meta = [];
    var sub = subtaskProgress(card);
    if (sub) {
      meta.push(
        h('span', { class: 'meta-item' }, [
          icon(ICON.checklist, 'icon'),
          `${sub.done}/${sub.total}`,
        ]),
      );
    }
    if (card.comments?.length) {
      meta.push(
        h('span', { class: 'meta-item' }, [
          icon(ICON.comment, 'icon'),
          String(card.comments.length),
        ]),
      );
    }
    var gateChip = exitGateChip(card, col);
    if (gateChip) {
      meta.push(gateChip);
    }
    fieldDefs().forEach(function (def) {
      if (!def.showOnCard) {
        return;
      }
      var chip = showOnCardChip(def, card);
      if (chip) {
        meta.push(chip);
      }
    });
    meta.push(h('div', { class: 'meta-spacer' }));
    meta.push(h('span', { class: 'meta-updated' }, humanizeTime(card.updatedAt)));
    if (card.agent) {
      var av = agentAvatar(card.agent);
      meta.push(
        h(
          'span',
          { class: 'meta-avatar', title: card.agent, style: `background:${av.color};` },
          av.initials,
        ),
      );
    }
    children.push(h('div', { class: 'card-meta' }, meta));

    var openCard = function () {
      state.openCardId = cardId;
      render();
    };
    var cardEl = h(
      'div',
      {
        class: 'card',
        draggable: true,
        dataset: { cardId: cardId },
        // The card face is the way into the card view, so it is reachable and
        // activatable from the keyboard, not just by mouse.
        role: 'button',
        tabindex: '0',
        'aria-label': `Open ${noun(false)} ${card.title}`,
        onClick: openCard,
        onKeyDown: function (e) {
          if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') {
            return;
          }
          if (e.target !== cardEl) {
            return; // a button inside the card (Copy ref) handles its own keys
          }
          e.preventDefault();
          openCard();
        },
        onDragStart: function (e) {
          onCardDragStart(e, cardId, cardEl);
        },
        onDragEnd: onDragEnd,
        onDragOver: function (e) {
          onCardDragOver(e, cardEl);
        },
      },
      children,
    );
    return cardEl;
  }

  /* ---- Column ---- */
  function buildColumn(col) {
    var b = board();
    var visible = [];
    var total = 0;
    for (var i = 0; i < col.cardIds.length; i++) {
      var c = b.cards[col.cardIds[i]];
      if (!c) {
        continue;
      }
      total++;
      if (matches(c)) {
        visible.push({ id: col.cardIds[i], card: c });
      }
    }
    // D-2: the count and the WIP state describe the COLUMN, not the current
    // search — a filter must never make an over-WIP column look healthy.
    var filtering = isFiltering();

    var head = [
      h('span', { class: 'col-dot', style: `background:${col.color};` }),
      h('span', { class: 'col-name' }, col.name),
    ];
    var hasEnter = col.enter?.length;
    var hasExit = col.exit?.length;
    if (hasEnter || hasExit) {
      var tip = [];
      if (hasEnter) {
        tip.push(`enter: ${col.enter.map(gateLabel).join(', ')}`);
      }
      if (hasExit) {
        tip.push(`exit: ${col.exit.map(gateLabel).join(', ')}`);
      }
      head.push(h('span', { class: 'col-gate-glyph', title: tip.join(' / '), html: ICON.shield }));
    }
    head.push(
      h(
        'span',
        { class: 'col-count' },
        filtering ? `${visible.length} of ${total}` : String(total),
      ),
    );
    head.push(h('div', { class: 'col-head-spacer' }));
    if (col.wip) {
      var over = total > col.wip;
      head.push(
        h(
          'span',
          { class: `wip${over ? ' over' : ''}`, title: 'Work-in-progress limit' },
          `${total}/${col.wip}`,
        ),
      );
    }

    var listChildren = visible.map(function (x) {
      return buildCard(x.id, x.card, col);
    });
    var list = h('div', { class: 'card-list', dataset: { colId: col.id } }, listChildren);

    var composer = buildComposer(col);

    var colEl = h(
      'div',
      {
        class: 'column',
        dataset: { colId: col.id },
        onDragOver: function (e) {
          onColumnDragOver(e, colEl, list);
        },
        onDrop: function (e) {
          onColumnDrop(e);
        },
      },
      [h('div', { class: 'col-head' }, head), list, composer],
    );
    return colEl;
  }

  function buildComposer(col) {
    if (state.addingCol === col.id) {
      var textarea = h('textarea', {
        id: `composer-${col.id}`,
        placeholder: isFeatureSet()
          ? 'Enter a name for this feature...'
          : 'Enter a title for this card...',
        onInput: function (e) {
          addText = e.target.value; // no render
        },
        onKeyDown: function (e) {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            saveCard(col.id);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelComposer();
          }
        },
      });
      textarea.value = addText;
      var actions = h('div', { class: 'composer-actions' }, [
        h(
          'button',
          {
            class: 'btn-primary',
            onClick: function () {
              saveCard(col.id);
            },
          },
          isFeatureSet() ? 'Add feature' : 'Add card',
        ),
        h(
          'button',
          {
            class: 'btn-cancel',
            'aria-label': `Cancel adding a ${noun(false)}`,
            onClick: cancelComposer,
          },
          '✕',
        ),
      ]);
      return h('div', { class: 'composer' }, [textarea, actions]);
    }
    return h('div', { class: 'composer' }, [
      h(
        'button',
        {
          class: 'add-card-btn',
          onClick: function () {
            state.addingCol = col.id;
            addText = '';
            render();
          },
        },
        [h('span', { class: 'plus' }, '+'), ` Add a ${noun(false)}`],
      ),
    ]);
  }

  function saveCard(colId) {
    var value = addText.trim();
    if (value) {
      vscode.postMessage({ type: 'addCard', column: colId, title: value });
    }
    state.addingCol = null;
    addText = '';
    render();
  }

  function cancelComposer() {
    state.addingCol = null;
    addText = '';
    render();
  }

  /* ---- Canvas ---- */
  function buildCanvas() {
    var b = board();
    var counts = cardCounts();
    // A filter that matches nothing left every column blank with no
    // explanation; say so, and offer the way back.
    if (isFiltering() && counts.visible === 0) {
      return h('div', { class: 'canvas' }, [
        h('div', { class: 'board-empty' }, [
          h('div', { class: 'board-empty-line' }, `No matches for “${state.query.trim()}”`),
          h('button', { class: 'btn-secondary', onClick: clearFilter }, 'Clear filter'),
        ]),
      ]);
    }
    var cols = (b.columns || []).map(buildColumn);
    var addList = can('addColumn')
      ? h('div', { class: 'add-list-wrap' }, [
          h(
            'button',
            {
              class: 'add-list-btn',
              onClick: function () {
                vscode.postMessage({ type: 'addColumn' });
              },
            },
            [h('span', { class: 'plus' }, '+'), ' Add another list'],
          ),
        ])
      : null;
    var inner = h('div', { class: 'canvas-inner' }, cols.concat([addList]));
    // The strip is focusable and arrow-scrollable, and fades at the right edge
    // while there are columns past it — board overflow was otherwise silent.
    var canvas = h(
      'div',
      {
        class: 'canvas',
        tabindex: '0',
        role: 'region',
        'aria-label': 'Board columns — scroll with the arrow keys',
        onWheel: onCanvasWheel,
        onKeyDown: onCanvasKeys,
        onScroll: syncCanvasOverflow,
      },
      [inner],
    );
    return h('div', { class: 'canvas-wrap' }, [
      canvas,
      h('div', { class: 'canvas-fade', 'aria-hidden': 'true' }),
    ]);
  }

  var CANVAS_STEP = 320; // one column plus its gap

  function onCanvasKeys(e) {
    if (e.target !== e.currentTarget) {
      return; // a card or an input inside the strip owns its own keys
    }
    var canvas = e.currentTarget;
    if (e.key === 'ArrowRight') {
      canvas.scrollLeft += CANVAS_STEP;
    } else if (e.key === 'ArrowLeft') {
      canvas.scrollLeft -= CANVAS_STEP;
    } else if (e.key === 'Home') {
      canvas.scrollLeft = 0;
    } else if (e.key === 'End') {
      canvas.scrollLeft = canvas.scrollWidth;
    } else {
      return;
    }
    e.preventDefault();
    syncCanvasOverflow();
  }

  /** Show the right-edge fade only while there is board left to scroll to. */
  function syncCanvasOverflow() {
    var canvas = document.querySelector('.canvas');
    var fade = document.querySelector('.canvas-fade');
    if (!canvas || !fade) {
      return;
    }
    var more = canvas.scrollWidth - canvas.clientWidth - canvas.scrollLeft > 2;
    fade.className = more ? 'canvas-fade on' : 'canvas-fade';
  }

  window.addEventListener('resize', syncCanvasOverflow);

  // Plain vertical wheel over the board BACKGROUND scrolls horizontally
  // (shift+wheel already does natively). Inside a column stack the wheel stays
  // strictly vertical — no horizontal fallthrough at the stack's edges.
  function onCanvasWheel(e) {
    if (e.shiftKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) {
      return;
    }
    if (e.target?.closest?.('.column')) {
      return; // stacks own the wheel
    }
    e.currentTarget.scrollLeft += e.deltaY;
    e.preventDefault();
  }

  /* ---- Status bar ---- */
  function buildStatusBar() {
    var counts = cardCounts();
    var countText = isFiltering()
      ? `${counts.visible} of ${counts.total} ${noun(true)}`
      : `${counts.total} ${noun(counts.total !== 1)}`;
    var boardPath = state.data?.boardPath || '';
    // G-1: the data directory was plain text; it now opens the board config,
    // where columns, gates, labels and fields are authored.
    var configPath = boardPath ? `${boardPath.replace(/\/*$/, '/')}.config.json` : '';
    var pathNode = configPath
      ? h(
          'button',
          {
            class: 'status-datadir status-link',
            title: `Open ${configPath}`,
            'aria-label': `Open board config ${configPath}`,
            onClick: function () {
              vscode.postMessage({ type: 'openFile', path: configPath });
            },
          },
          boardPath,
        )
      : h('span', { class: 'status-datadir' }, boardPath);
    return h('div', { class: 'statusbar' }, [
      h('span', {}, countText),
      h('div', { class: 'status-spacer' }),
      pathNode,
    ]);
  }

  /* ---- Card detail modal ---- */
  // Modal width from the resolved reading-width token: presets map to CSS
  // classes; a custom CSS length (host-sanitized) becomes an inline width.
  function readingWidthToken() {
    return state.data?.readingWidth || 'wide';
  }
  function modalWidthClass() {
    var t = readingWidthToken();
    var preset = t === 'narrow' || t === 'wide' || t === 'full';
    return `modal width-${preset ? t : 'custom'}`;
  }
  function modalWidthStyle() {
    var t = readingWidthToken();
    var preset = t === 'narrow' || t === 'wide' || t === 'full';
    return preset ? null : `width:${t};`;
  }

  function columnOfCard(cardId) {
    var b = board();
    for (var i = 0; i < b.columns.length; i++) {
      if (b.columns[i].cardIds.indexOf(cardId) !== -1) {
        return b.columns[i];
      }
    }
    return null;
  }

  // The repo-relative file backing a card (host-resolved, see DataMessage).
  /** Asks the host to put the card's `<board>/<id> — <title> (<path>)` ref on the clipboard. */
  function copyRef(cardId) {
    vscode.postMessage({ type: 'copyRef', cardId: cardId });
  }

  function cardFileOf(cardId) {
    var files = state.data?.cardFiles;
    return files?.[cardId] ? files[cardId] : null;
  }

  // G-2: one message carries every reserved-metadata edit.
  function postMeta(cardId, patch) {
    if (!cardId || !can('meta')) {
      return;
    }
    vscode.postMessage({ type: 'updateMeta', cardId: cardId, patch: patch });
  }

  function modalHead(card, col) {
    // The column badge lives in the status row below the title now, so the
    // badge strip carries the card's own labels only.
    var badges = (card.labels || []).map(labelChip).filter(Boolean);

    var titleNode;
    if (can('meta') && state.editingTitle) {
      // Same post-on-change pattern as the text field editor: typing never
      // re-renders, so the input keeps focus and the caret.
      var titleInput = h('input', {
        id: 'title-input',
        class: 'title-input',
        'aria-label': 'Card title',
        onChange: function (e) {
          var next = String(e.target.value).replace(/\s+/g, ' ').trim();
          state.editingTitle = false;
          if (next && next !== card.title) {
            postMeta(card.id, { title: next });
          } else {
            render();
          }
        },
        onKeyDown: function (e) {
          if (e.key === 'Escape') {
            e.preventDefault();
            state.editingTitle = false;
            render(); // revert: the input is discarded unsaved
          } else if (e.key === 'Enter') {
            e.preventDefault();
            e.target.blur(); // fires change, which saves
          }
        },
        onBlur: function () {
          // Leave edit mode on blur, but late enough that a click on another
          // header button still lands.
          setTimeout(function () {
            if (state.editingTitle) {
              state.editingTitle = false;
              render();
            }
          }, 150);
        },
      });
      titleInput.value = card.title;
      titleNode = titleInput;
    } else {
      titleNode = h(
        'div',
        {
          class: `modal-title${can('meta') ? ' editable' : ''}`,
          title: can('meta') ? 'Click to rename' : null,
          onClick: can('meta')
            ? function () {
                state.editingTitle = true;
                render();
              }
            : null,
        },
        card.title,
      );
    }

    var actions = [];
    actions.push(
      h(
        'button',
        {
          class: 'ghost-btn',
          title: 'Copy a pasteable reference: <board>/<id> — <title> (<path>)',
          'aria-label': `Copy ref for ${card.id}`,
          onClick: function () {
            copyRef(card.id);
          },
        },
        [icon(ICON.copy, 'icon'), ' Copy ref'],
      ),
    );
    var file = cardFileOf(card.id);
    if (file) {
      actions.push(
        h(
          'button',
          {
            class: 'ghost-btn',
            title: `Open ${file}`,
            'aria-label': `Open file ${file}`,
            onClick: function () {
              vscode.postMessage({ type: 'openFile', path: file });
            },
          },
          [icon(ICON.file, 'icon'), ' Open file'],
        ),
      );
    }
    actions.push(
      h('button', { class: 'modal-close', 'aria-label': 'Close card', onClick: closeModal }, '✕'),
    );

    return h('div', { class: 'modal-head' }, [
      h('div', { class: 'modal-head-row' }, [
        h('div', { class: 'modal-head-main' }, [
          badges.length ? h('div', { class: 'modal-badges' }, badges) : null,
          titleNode,
          h(
            'code',
            {
              class: 'modal-id',
              title: 'Card id — click to copy the ref',
              onClick: function () {
                copyRef(card.id);
              },
            },
            `${state.data ? state.data.boardId : ''}/${card.id}`,
          ),
        ]),
        h('div', { class: 'modal-head-actions' }, actions),
      ]),
      modalStatusRow(card, col),
    ]);
  }

  // Surface 4: what the CLI prints after a successful move ("Now that <card> is
  // in <Column>: …") shown where a human meets it — in the card, under the
  // header. Dismissal is per card+column and lives in webview state only.
  function modalColumnPrompt(card, col) {
    if (!col) {
      return null;
    }
    var html = state.data?.columnPromptHtml ? state.data.columnPromptHtml[col.id] : null;
    if (!html && !col.prompt) {
      return null;
    }
    var key = `${card.id}|${col.id}`;
    if (state.dismissedPrompts[key]) {
      return null;
    }
    return h('div', { class: 'col-prompt' }, [
      h('div', { class: 'col-prompt-head' }, [
        h('div', { class: 'field-label', style: 'margin-bottom:0;' }, 'In this column'),
        h('div', { class: 'col-prompt-spacer' }),
        h(
          'button',
          {
            class: 'ghost-btn',
            'aria-label': 'Dismiss this column note',
            onClick: function () {
              state.dismissedPrompts[key] = true;
              persistDismissed();
              render();
            },
          },
          'Dismiss',
        ),
      ]),
      contentBlock('col-prompt-body', html, col.prompt || ''),
    ]);
  }

  function priorityEditor(card) {
    if (!can('meta')) {
      var prV = PRIORITY_VARS[card.priority] || PRIORITY_VARS.none;
      var prL = PRIORITY_LABELS[card.priority] || PRIORITY_LABELS.none;
      return h('span', { class: 'priority-pill', style: tintVar(prV.token) }, prL);
    }
    var select = h(
      'select',
      {
        class: 'field-select',
        'aria-label': 'Priority',
        onChange: function (e) {
          var v = e.target.value;
          postMeta(card.id, { priority: v === '' ? null : v });
        },
      },
      PRIORITY_OPTIONS.map(function (opt) {
        return h('option', { value: opt.value }, opt.label);
      }),
    );
    select.value = card.priority || '';
    return select;
  }

  // Declared labels as toggle chips, tinted with the label's own (data) colour.
  function labelsEditor(card) {
    var labels = config().labels || {};
    var keys = Object.keys(labels);
    if (!keys.length) {
      return null;
    }
    var current = Array.isArray(card.labels) ? card.labels.slice() : [];
    var toggle = function (key) {
      var next = current.slice();
      var at = next.indexOf(key);
      if (at === -1) {
        next.push(key);
      } else {
        next.splice(at, 1);
      }
      postMeta(card.id, { labels: next.length ? next : null });
    };
    var chips = keys.map(function (key) {
      var def = labels[key];
      var on = current.indexOf(key) !== -1;
      return h(
        'span',
        {
          class: `ms-chip label-toggle${on ? ' on' : ''}`,
          style: on ? tintStyle(def.color) : `border-color:${def.color}55;`,
          role: 'checkbox',
          tabindex: '0',
          'aria-checked': on ? 'true' : 'false',
          onClick: function () {
            toggle(key);
          },
          onKeyDown: function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggle(key);
            }
          },
        },
        def.name,
      );
    });
    return h('div', { class: 'ms-chips' }, chips);
  }

  // G-2 / D-7: an always-present Activity row. The old banner only appeared
  // while a card was live, so the owner was invisible the rest of the time.
  function activityRow(card) {
    if (!can('meta') || isFeatureSet()) {
      return null; // a .feature file has nowhere to put an agent, live flag or progress
    }
    var live = card.live === true;
    var setLive = function () {
      postMeta(card.id, { live: live ? null : true }); // off clears the key, like `card update --live false`
    };

    var agentInput = h('input', {
      class: 'field-input',
      placeholder: 'who is on this',
      'aria-label': 'Agent',
      onChange: function (e) {
        var v = String(e.target.value).trim();
        postMeta(card.id, { agent: v === '' ? null : v });
      },
    });
    agentInput.value = card.agent || '';

    var liveToggle = h(
      'div',
      {
        class: 'field-bool',
        role: 'checkbox',
        tabindex: '0',
        'aria-checked': live ? 'true' : 'false',
        'aria-label': 'Live',
        onClick: setLive,
        onKeyDown: function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setLive();
          }
        },
      },
      [
        h(
          'span',
          { class: `check-box${live ? ' done' : ''}` },
          live ? [icon(ICON.check, 'icon')] : [],
        ),
        h('span', { class: 'field-bool-label' }, live ? 'Live' : 'Not live'),
      ],
    );

    var cells = [
      h('div', { class: 'activity-cell activity-agent' }, [
        h('div', { class: 'field-label' }, 'Agent'),
        agentInput,
      ]),
      h('div', { class: 'activity-cell' }, [
        h('div', { class: 'field-label' }, 'Live'),
        liveToggle,
      ]),
    ];

    if (live) {
      var statusInput = h('input', {
        class: 'field-input',
        placeholder: 'what is happening right now',
        'aria-label': 'Status',
        onChange: function (e) {
          var v = String(e.target.value).trim();
          postMeta(card.id, { status: v === '' ? null : v });
        },
      });
      statusInput.value = card.status || '';
      var progressInput = h('input', {
        type: 'number',
        min: '0',
        max: '100',
        class: 'field-input field-input-num',
        'aria-label': 'Progress percent',
        onChange: function (e) {
          var raw = String(e.target.value).trim();
          if (raw === '') {
            postMeta(card.id, { progress: null });
            return;
          }
          var n = Number(raw);
          if (!isNaN(n)) {
            postMeta(card.id, { progress: n });
          }
        },
      });
      progressInput.value = typeof card.progress === 'number' ? String(card.progress) : '';
      cells.push(
        h('div', { class: 'activity-cell activity-status' }, [
          h('div', { class: 'field-label' }, 'Status'),
          statusInput,
        ]),
        h('div', { class: 'activity-cell' }, [
          h('div', { class: 'field-label' }, 'Progress %'),
          progressInput,
        ]),
      );
    }

    return h('div', { class: 'section activity-row' }, cells);
  }

  function modalMeta(card) {
    var cells = [];
    // Priority and labels are card-board metadata: a feature's labels are the
    // tags in its file, and it has no priority at all — so the row is not shown
    // for features rather than shown empty or, worse, editable.
    if (isFeatureSet()) {
      return null;
    }
    // A surface that cannot edit priority has nothing useful to say when none
    // is set — do not print "None".
    if (can('meta') || card.priority) {
      cells.push(
        h('div', {}, [h('div', { class: 'field-label' }, 'Priority'), priorityEditor(card)]),
      );
    }
    if (can('meta')) {
      var labelsNode = labelsEditor(card);
      if (labelsNode) {
        cells.push(
          h('div', { class: 'modal-cols-labels' }, [
            h('div', { class: 'field-label' }, 'Labels'),
            labelsNode,
          ]),
        );
      }
    }
    if (!cells.length) {
      return null;
    }
    return h('div', { class: 'modal-cols' }, cells);
  }

  function saveDescription(card) {
    vscode.postMessage({ type: 'setDescription', cardId: card.id, text: descText });
    state.editingDesc = false;
    render();
  }

  // G-7: the Description section is always present when this surface can write
  // it, so a new card offers somewhere to say what it is about.
  function modalDescription(card) {
    var editable = can('description');
    var html = state.data?.descHtml ? state.data.descHtml[card.id] : null;

    if (editable && state.editingDesc) {
      var textarea = h('textarea', {
        id: 'desc-editor',
        class: 'comment-input',
        'aria-label': 'Card description',
        placeholder: 'What is this card about?',
        onInput: function (e) {
          descText = e.target.value; // no render
        },
        onKeyDown: function (e) {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            saveDescription(card);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            state.editingDesc = false;
            render();
          }
        },
      });
      textarea.value = descText;
      return h('div', { class: 'section' }, [
        h('div', { class: 'field-label' }, 'Description'),
        textarea,
        h('div', { class: 'composer-actions' }, [
          h(
            'button',
            {
              class: 'btn-primary',
              onClick: function () {
                saveDescription(card);
              },
            },
            'Save',
          ),
          h(
            'button',
            {
              class: 'btn-secondary',
              onClick: function () {
                state.editingDesc = false;
                render();
              },
            },
            'Cancel',
          ),
        ]),
      ]);
    }

    if (!editable && !card.desc) {
      return null;
    }

    var head = [h('div', { class: 'field-label', style: 'margin-bottom:0;' }, 'Description')];
    var startEditing = function () {
      state.editingDesc = true;
      descText = card.desc || '';
      render();
    };
    if (editable) {
      head.push(h('div', { class: 'section-head-spacer' }));
      head.push(
        h('button', { class: 'ghost-btn', onClick: startEditing }, card.desc ? 'Edit' : 'Add'),
      );
    }
    var body = card.desc
      ? contentBlock('section-desc', html, card.desc)
      : h(
          'div',
          {
            class: 'section-desc desc-placeholder',
            onClick: startEditing,
          },
          'Add a description…',
        );
    return h('div', { class: 'section' }, [h('div', { class: 'section-head' }, head), body]);
  }

  /* ---- Scenarios (feature sets only) ---- */

  function scenariosOf(card) {
    return Array.isArray(card.scenarios) ? card.scenarios : [];
  }

  function scenarioKeyFor(cardId, index) {
    return scenarioDraftKey(boardIdOf(), cardId, index);
  }

  /** Open an editor over a scenario (or over nothing, for the composer). */
  function editScenario(card, index, scenario) {
    var key = scenarioKeyFor(card.id, index);
    var name = scenario ? scenario.name : '';
    var steps = scenario ? joinSteps(scenario.steps) : '';
    scenarioDrafts = setScenarioDraft(scenarioDrafts, key, {
      name: name,
      steps: steps,
      // What the file said when editing started: an external change no longer
      // matches it, and that is what the block reports instead of overwriting.
      base: { name: name, steps: steps },
    });
    delete scenarioError[key];
    delete scenarioFailed[key];
    confirmRemoveKey = null;
    focusScenario = `scenario-name-${index}`;
    render();
  }

  function cancelScenario(key) {
    scenarioDrafts = clearScenarioDraft(scenarioDrafts, key);
    delete scenarioError[key];
    delete scenarioFailed[key];
    delete scenarioPending[key];
    delete lastPosted[key];
    render();
  }

  /**
   * Post the draft at `key`. The draft is NOT cleared here: it stays until the
   * file comes back saying the same thing (see reconcileScenarioSaves), so a
   * refused or lost write leaves the text on screen rather than dropping it.
   */
  function saveScenario(card, key, index) {
    var draft = getScenarioDraft(scenarioDrafts, key);
    if (!draft) {
      return;
    }
    var name = draft.name.replace(/\s+/g, ' ').trim();
    if (!name) {
      scenarioError[key] = 'A scenario needs a name.';
      focusScenario = `scenario-name-${index}`;
      render();
      return;
    }
    delete scenarioError[key];
    delete scenarioFailed[key];
    var steps = splitSteps(draft.steps);
    vscode.postMessage(
      index === NEW_SCENARIO
        ? { type: 'addScenario', cardId: card.id, name: name, steps: steps }
        : { type: 'setScenario', cardId: card.id, index: index, name: name, steps: steps },
    );
    scenarioPending[key] = { cardId: card.id, index: index, name: name, steps: steps };
    lastPosted[key] = scenarioPending[key];
    watchScenarioSave(key);
    render();
  }

  // A write that never arrives must not leave the block saying "Saving…"
  // forever: after a moment it says it did not save, and keeps the text.
  function watchScenarioSave(key) {
    setTimeout(function () {
      if (!scenarioPending[key]) {
        return;
      }
      delete scenarioPending[key];
      scenarioFailed[key] = true;
      render();
    }, 4000);
  }

  /**
   * Match each posted scenario against what the file now says. On a match the
   * draft is done: it is dropped and the block flashes "Saved". Called on every
   * data message, before the render that shows it.
   *
   * A save that was given up on (see watchScenarioSave) is checked too: a write
   * that simply took longer than the wait must still be recognised when it
   * lands, rather than leaving the editor open over a file that agrees with it.
   */
  function reconcileScenarioSaves() {
    Object.keys(scenarioPending).forEach(function (key) {
      confirmScenarioSave(key, scenarioPending[key]);
    });
    Object.keys(scenarioFailed).forEach(function (key) {
      var draft = getScenarioDraft(scenarioDrafts, key);
      if (draft) {
        confirmScenarioSave(key, lastPosted[key]);
      }
    });
  }

  function confirmScenarioSave(key, posted) {
    if (!posted) {
      return;
    }
    var cards = board() ? board().cards : null;
    var card = cards ? cards[posted.cardId] : null;
    if (!card) {
      return;
    }
    var list = scenariosOf(card);
    // A new scenario is appended, so the file's last one is the one just sent.
    var at = posted.index === NEW_SCENARIO ? list.length - 1 : posted.index;
    var stored = list[at];
    var asDraft = { name: posted.name, steps: joinSteps(posted.steps), base: null };
    if (!draftMatchesStored(asDraft, stored)) {
      return; // not (yet) what the file says — leave the block saying "Saving…"
    }
    delete scenarioPending[key];
    delete scenarioFailed[key];
    delete lastPosted[key];
    scenarioDrafts = clearScenarioDraft(scenarioDrafts, key);
    flashScenarioSaved(scenarioKeyFor(posted.cardId, at));
  }

  function flashScenarioSaved(key) {
    scenarioSaved[key] = true;
    setTimeout(function () {
      delete scenarioSaved[key];
      render();
    }, 2600);
  }

  function removeScenario(card, index) {
    confirmRemoveKey = null;
    vscode.postMessage({ type: 'removeScenario', cardId: card.id, index: index });
    render();
  }

  /** The keyword + name line every block shows, editing or not. */
  function scenarioKeywordChip(scenario) {
    return h('span', { class: 'scenario-keyword' }, `${scenario.keyword || 'Scenario'}:`);
  }

  function scenarioTags(scenario) {
    var tags = Array.isArray(scenario.tags) ? scenario.tags : [];
    if (!tags.length) {
      return null;
    }
    // The tags are shown, not edited: they are the file's, and RepoDoc only
    // rewrites what it can round-trip.
    return h(
      'div',
      { class: 'scenario-tags', title: 'Tags are edited in the .feature file' },
      tags.map(function (tag) {
        return h('span', { class: 'scenario-tag' }, tag);
      }),
    );
  }

  function scenarioReader(card, scenario, index, key) {
    var actions = [];
    if (scenarioSaved[key]) {
      actions.push(
        h('span', { class: 'scenario-saved', role: 'status' }, [
          icon(ICON.check, 'icon'),
          ' Saved',
        ]),
      );
    }
    if (confirmRemoveKey === key) {
      actions.push(
        h('span', { class: 'scenario-confirm' }, 'Remove this scenario?'),
        h(
          'button',
          {
            class: 'ghost-btn danger',
            'aria-label': `Confirm removing scenario ${scenario.name}`,
            onClick: function () {
              removeScenario(card, index);
            },
          },
          'Remove',
        ),
        h(
          'button',
          {
            class: 'ghost-btn',
            onClick: function () {
              confirmRemoveKey = null;
              render();
            },
          },
          'Keep',
        ),
      );
    } else {
      actions.push(
        h(
          'button',
          {
            class: 'ghost-btn',
            'aria-label': `Edit scenario ${scenario.name}`,
            onClick: function () {
              editScenario(card, index, scenario);
            },
          },
          'Edit',
        ),
        h(
          'button',
          {
            class: 'ghost-btn',
            'aria-label': `Remove scenario ${scenario.name}`,
            onClick: function () {
              confirmRemoveKey = key;
              render();
            },
          },
          'Remove',
        ),
      );
    }

    var steps = scenario.steps || [];
    return h('div', { class: 'scenario' }, [
      h('div', { class: 'scenario-head' }, [
        h('div', { class: 'scenario-title' }, [scenarioKeywordChip(scenario), ' ', scenario.name]),
        h('div', { class: 'section-head-spacer' }),
        h('div', { class: 'scenario-actions' }, actions),
      ]),
      scenarioTags(scenario),
      steps.length
        ? h('pre', { class: 'scenario-steps' }, steps.join('\n'))
        : h('div', { class: 'scenario-steps empty' }, 'No steps yet.'),
    ]);
  }

  function scenarioEditor(card, scenario, index, key, draft) {
    var nameId = `scenario-name-${index}`;
    var stepsId = `scenario-steps-${index}`;
    var pending = Boolean(scenarioPending[key]);

    var nameInput = h('input', {
      id: nameId,
      class: 'field-input',
      placeholder: 'What the scenario proves',
      'aria-label': 'Scenario name',
      onInput: function (e) {
        // No render: the draft is state, the input is already showing it.
        scenarioDrafts = setScenarioDraft(
          scenarioDrafts,
          key,
          Object.assign({}, getScenarioDraft(scenarioDrafts, key), { name: e.target.value }),
        );
      },
      onKeyDown: function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          saveScenario(card, key, index);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancelScenario(key);
        }
      },
    });
    nameInput.value = draft.name;

    var stepsInput = h('textarea', {
      id: stepsId,
      class: 'comment-input scenario-steps-input',
      rows: '6',
      placeholder: 'Given a card in todo\nWhen I move it to review\nThen the move is refused',
      'aria-label': 'Scenario steps, one per line',
      onInput: function (e) {
        scenarioDrafts = setScenarioDraft(
          scenarioDrafts,
          key,
          Object.assign({}, getScenarioDraft(scenarioDrafts, key), { steps: e.target.value }),
        );
      },
      onKeyDown: function (e) {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          saveScenario(card, key, index);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancelScenario(key);
        }
      },
    });
    stepsInput.value = draft.steps;

    var notices = [];
    if (scenarioError[key]) {
      notices.push(h('div', { class: 'scenario-notice error', role: 'alert' }, scenarioError[key]));
    }
    if (scenarioFailed[key]) {
      notices.push(
        h(
          'div',
          { class: 'scenario-notice error', role: 'alert' },
          'Not saved — the file did not change. Your text is still here; try again or use Open file.',
        ),
      );
    }
    // The file moved under an open edit: neither side wins silently.
    if (index !== NEW_SCENARIO && scenarioChangedUnderDraft(draft, scenario)) {
      notices.push(
        h('div', { class: 'scenario-notice', role: 'alert' }, [
          h('span', {}, 'Changed on disk while you were editing.'),
          h(
            'button',
            {
              class: 'ghost-btn',
              onClick: function () {
                editScenario(card, index, scenario); // reload = start again from the file
              },
            },
            'Reload',
          ),
          h(
            'button',
            {
              class: 'ghost-btn',
              onClick: function () {
                var current = getScenarioDraft(scenarioDrafts, key);
                scenarioDrafts = setScenarioDraft(
                  scenarioDrafts,
                  key,
                  Object.assign({}, current, {
                    base: {
                      name: scenario ? scenario.name : '',
                      steps: scenario ? joinSteps(scenario.steps) : '',
                    },
                  }),
                );
                render();
              },
            },
            'Keep mine',
          ),
        ]),
      );
    }

    return h('div', { class: 'scenario editing' }, [
      h('div', { class: 'scenario-head' }, [
        scenario
          ? scenarioKeywordChip(scenario)
          : h('span', { class: 'scenario-keyword' }, 'Scenario:'),
        h('div', { class: 'scenario-name-cell' }, [nameInput]),
      ]),
      scenario ? scenarioTags(scenario) : null,
      h('div', { class: 'field-label scenario-steps-label' }, 'Steps — one per line'),
      stepsInput,
      notices.length ? h('div', { class: 'scenario-notices' }, notices) : null,
      h('div', { class: 'composer-actions' }, [
        h(
          'button',
          {
            class: 'btn-primary',
            disabled: pending ? 'disabled' : null,
            onClick: function () {
              saveScenario(card, key, index);
            },
          },
          pending ? 'Saving…' : 'Save',
        ),
        h(
          'button',
          {
            class: 'btn-secondary',
            onClick: function () {
              cancelScenario(key);
            },
          },
          'Cancel',
        ),
      ]),
    ]);
  }

  /** The composer at the end of the list: the same editor over nothing. */
  function scenarioComposer(card) {
    var key = scenarioKeyFor(card.id, NEW_SCENARIO);
    var draft = getScenarioDraft(scenarioDrafts, key);
    if (draft) {
      return scenarioEditor(card, null, NEW_SCENARIO, key, draft);
    }
    return h(
      'button',
      {
        class: 'add-card-btn',
        onClick: function () {
          editScenario(card, NEW_SCENARIO, null);
        },
      },
      [h('span', { class: 'plus' }, '+'), ' Add scenario'],
    );
  }

  /**
   * The feature's scenarios, each editable in place. Only a surface that
   * declares `scenarios` has them; a card board never renders this section.
   */
  function modalScenarios(card) {
    if (!isFeatureSet()) {
      return null;
    }
    var list = scenariosOf(card);
    var blocks = list.map(function (scenario, index) {
      var key = scenarioKeyFor(card.id, index);
      var draft = getScenarioDraft(scenarioDrafts, key);
      return draft
        ? scenarioEditor(card, scenario, index, key, draft)
        : scenarioReader(card, scenario, index, key);
    });
    blocks.push(scenarioComposer(card));
    return h('div', { class: 'section' }, [
      h('div', { class: 'section-head' }, [
        h('div', { class: 'field-label', style: 'margin-bottom:0;' }, 'Scenarios'),
        list.length ? h('span', { class: 'checklist-count' }, String(list.length)) : null,
      ]),
      h('div', { class: 'scenario-list' }, blocks),
    ]);
  }

  function saveChecklistItem(card) {
    var text = checkText.trim();
    if (!text) {
      return;
    }
    vscode.postMessage({ type: 'addChecklistItem', cardId: card.id, text: text });
    // Clear locally and stay open so several steps can be typed in a row; the
    // resulting data refresh brings the persisted item.
    checkText = '';
    var input = document.getElementById('check-composer');
    if (input) {
      input.value = '';
    }
  }

  function checklistComposer(card) {
    if (!can('checklistAdd')) {
      return null;
    }
    if (!state.addingCheck) {
      return h(
        'button',
        {
          class: 'add-card-btn',
          onClick: function () {
            state.addingCheck = true;
            checkText = '';
            render();
          },
        },
        [h('span', { class: 'plus' }, '+'), ' Add item'],
      );
    }
    var input = h('input', {
      id: 'check-composer',
      class: 'field-input',
      placeholder: 'Add an item…',
      'aria-label': 'New checklist item',
      onInput: function (e) {
        checkText = e.target.value; // no render
      },
      onKeyDown: function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          saveChecklistItem(card);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          state.addingCheck = false;
          checkText = '';
          render();
        }
      },
    });
    input.value = checkText;
    return h('div', { class: 'check-composer' }, [
      input,
      h(
        'button',
        {
          class: 'btn-primary',
          onClick: function () {
            saveChecklistItem(card);
          },
        },
        'Add',
      ),
      h(
        'button',
        {
          class: 'btn-cancel',
          'aria-label': 'Cancel adding an item',
          onClick: function () {
            state.addingCheck = false;
            checkText = '';
            render();
          },
        },
        '✕',
      ),
    ]);
  }

  function modalChecklist(card) {
    var items = card.checklist || [];
    if (!items.length && !can('checklistAdd')) {
      return null;
    }
    var done = 0;
    items.forEach(function (x) {
      if (x.done) {
        done++;
      }
    });
    var toggles = can('checklist');
    // A real checkbox with a real label: focusable, Space-operable, and
    // announced with its checked state — the visual box is CSS on the input.
    var itemNodes = items.map(function (item, index) {
      var inputId = `check-${card.id}-${index}`;
      var box = h('input', {
        type: 'checkbox',
        id: inputId,
        class: 'check-box',
        onChange: function () {
          vscode.postMessage({
            type: 'toggleCheck',
            cardId: card.id,
            index: index,
          });
        },
      });
      box.checked = item.done === true;
      box.disabled = !toggles;
      return h('div', { class: 'check-item' }, [
        box,
        h('label', { class: `check-text${item.done ? ' done' : ''}`, for: inputId }, item.text),
      ]);
    });
    return h('div', { class: 'section' }, [
      h('div', { class: 'checklist-head' }, [
        h('div', { class: 'field-label', style: 'margin-bottom:0;' }, 'Checklist'),
        items.length ? h('span', { class: 'checklist-count' }, `${done}/${items.length}`) : null,
      ]),
      itemNodes.length ? h('div', { class: 'checklist' }, itemNodes) : null,
      checklistComposer(card),
    ]);
  }

  // Scan comment text for file references (`path/to/file.ts`, optional `:12` or
  // `:12-34`) and return a list of text nodes / clickable link spans / <br>s.
  // Built with the DOM helper (never innerHTML): text nodes are inherently safe.
  var FILE_REF_RE = /(?:^|[\s(])((?:[\w.-]+\/)*[\w.-]+\.[A-Za-z]{1,8})(?::(\d+)(?:-(\d+))?)?/g;

  function fileLink(token, path, line, endLine) {
    var payload = { type: 'openFile', path: path };
    if (line) {
      payload.line = line;
    }
    if (endLine) {
      payload.endLine = endLine;
    }
    return h(
      'span',
      {
        class: 'file-link',
        onClick: function () {
          vscode.postMessage(payload);
        },
      },
      token,
    );
  }

  function appendLinkifiedLine(nodes, line) {
    FILE_REF_RE.lastIndex = 0;
    var last = 0;
    var m;
    while ((m = FILE_REF_RE.exec(line)) !== null) {
      var path = m[1];
      var startLine = m[2] ? parseInt(m[2], 10) : 0;
      var endLine = m[3] ? parseInt(m[3], 10) : 0;
      var token = path + (m[2] ? `:${m[2]}${m[3] ? `-${m[3]}` : ''}` : '');
      var tokenStart = m.index + (m[0].length - token.length);
      if (tokenStart > last) {
        nodes.push(line.slice(last, tokenStart)); // plain text (incl. any prefix char)
      }
      nodes.push(fileLink(token, path, startLine, endLine));
      last = tokenStart + token.length;
    }
    if (last < line.length) {
      nodes.push(line.slice(last));
    }
  }

  function linkifyFileRefs(text) {
    var nodes = [];
    var lines = String(text == null ? '' : text).split('\n');
    for (var i = 0; i < lines.length; i++) {
      if (i > 0) {
        nodes.push(h('br'));
      }
      appendLinkifiedLine(nodes, lines[i]);
    }
    return nodes;
  }

  // ---- Shared content-block enhancement ----
  // Every content block (descriptions, comments) is host-rendered by the one
  // shared markdown renderer, then enhanced here: plain-text file references
  // become one-click links, and mermaid fences render as diagrams.

  // Walk the rendered HTML and turn `path:line` text into clickable links,
  // skipping anything already inside a link, code, or an existing file link.
  function linkifyElement(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!node.nodeValue || node.nodeValue.indexOf('.') === -1) {
          return NodeFilter.FILTER_REJECT;
        }
        var p = node.parentElement;
        if (p?.closest('a, code, pre, .file-link')) {
          return NodeFilter.FILTER_REJECT;
        }
        FILE_REF_RE.lastIndex = 0;
        return FILE_REF_RE.test(node.nodeValue)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });
    var targets = [];
    var node;
    while ((node = walker.nextNode())) {
      targets.push(node);
    }
    targets.forEach(function (t) {
      var built = [];
      appendLinkifiedLine(built, t.nodeValue);
      var frag = document.createDocumentFragment();
      appendChildren(frag, built);
      t.parentNode.replaceChild(frag, t);
    });
  }

  var mermaidInited = false;
  function runMermaid(root) {
    if (!window.mermaid) {
      return;
    }
    if (!mermaidInited) {
      var kind = document.body.dataset.vscodeThemeKind || '';
      var dark = kind.indexOf('dark') !== -1 || kind === 'vscode-high-contrast';
      try {
        window.mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: dark ? 'dark' : 'default',
        });
      } catch (_e) {
        /* ignore */
      }
      mermaidInited = true;
    }
    var nodes = Array.prototype.slice.call(root.querySelectorAll('.mermaid')).filter(function (el) {
      return !el.getAttribute('data-processed');
    });
    if (nodes.length) {
      try {
        window.mermaid.run({ nodes: nodes });
      } catch (_e2) {
        /* ignore */
      }
    }
  }

  function enhanceContentBlocks(root) {
    var blocks = root.querySelectorAll('.content-md');
    for (var i = 0; i < blocks.length; i++) {
      linkifyElement(blocks[i]);
    }
    runMermaid(root);
  }

  // A content block: host-rendered HTML when available, else linkified plain
  // text as a fallback.
  function contentBlock(cls, html, fallbackText) {
    if (html) {
      return h('div', { class: `${cls} content-md`, html: html });
    }
    return h('div', { class: cls }, linkifyFileRefs(fallbackText || ''));
  }

  function submitComment() {
    var cardId = state.openCardId;
    if (!cardId) {
      return;
    }
    var text = getDraft(commentDrafts, boardIdOf(), cardId).trim();
    var who = (commentWho !== null ? commentWho : state.data?.commentAuthor || '').trim();
    if (!text) {
      return;
    }
    vscode.postMessage({ type: 'addComment', cardId: cardId, text: text, who: who });
    // The draft is spent — drop it so reopening this card starts clean; the
    // resulting data refresh brings the persisted entry.
    commentDrafts = clearDraft(commentDrafts, boardIdOf(), cardId);
    var ta = document.getElementById('comment-composer');
    if (ta) {
      ta.value = '';
    }
  }

  function modalComments(card) {
    if (!can('comments')) {
      return null;
    }
    var entries = Array.isArray(card.comments) ? card.comments : [];
    var htmls = state.data?.commentHtml ? state.data.commentHtml[card.id] : null;
    var list = entries.map(function (entry, index) {
      var html = htmls ? htmls[index] : null;
      return h('div', { class: 'comment-entry' }, [
        h('div', { class: 'comment-meta' }, [
          h('span', { class: 'comment-who' }, entry.who || '—'),
          h('span', { class: 'comment-time' }, humanizeTime(entry.at)),
        ]),
        contentBlock('comment-text', html, entry.text || ''),
      ]);
    });

    var textarea = h('textarea', {
      id: 'comment-composer',
      class: 'comment-input',
      placeholder: 'Add a comment — journal what changed…',
      onInput: function (e) {
        // No render: the draft is stored against THIS card only.
        commentDrafts = setDraft(commentDrafts, boardIdOf(), card.id, e.target.value);
      },
      onKeyDown: function (e) {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          submitComment();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          commentDrafts = clearDraft(commentDrafts, boardIdOf(), card.id);
          e.target.value = '';
        }
      },
    });
    textarea.value = getDraft(commentDrafts, boardIdOf(), card.id);

    var authorValue = commentWho !== null ? commentWho : state.data?.commentAuthor || '';
    var authorInput = h('input', {
      id: 'comment-author',
      class: 'comment-author-input',
      placeholder: 'name',
      title: 'Name recorded on your comments',
      onInput: function (e) {
        commentWho = e.target.value; // no render; overrides the configured name
      },
    });
    authorInput.value = authorValue;

    var composer = h('div', { class: 'comment-composer' }, [
      textarea,
      h('div', { class: 'comment-composer-actions' }, [
        h('span', { class: 'comment-as' }, 'as'),
        authorInput,
        h('div', { class: 'comment-composer-spacer' }),
        h('button', { class: 'btn-primary', onClick: submitComment }, 'Comment'),
      ]),
    ]);

    return h('div', { class: 'section' }, [
      h('div', { class: 'comments-head' }, [
        h('div', { class: 'field-label', style: 'margin-bottom:0;' }, 'Comments'),
        h('span', { class: 'comments-count' }, String(entries.length)),
      ]),
      list.length ? h('div', { class: 'comment-list' }, list) : null,
      composer,
    ]);
  }

  function postField(cardId, fieldId, value) {
    vscode.postMessage({ type: 'setField', cardId: cardId, fieldId: fieldId, value: value });
  }

  // Editor node for one custom field. Text/number/date post on 'change' (blur or
  // Enter) so typing never re-renders and the input keeps focus; toggles/selects
  // post immediately (the host echo re-render is harmless for those).
  // Editable inline from the modal AND from a gate row, so the card id comes
  // from the card itself rather than from whichever modal happens to be open.
  function fieldEditor(def, card) {
    var cardId = card.id;
    var val = card.custom?.[def.id];

    if (def.type === 'boolean') {
      var on = val === true;
      // Same treatment as a checklist item: a native checkbox carries the
      // checked state and the keyboard behaviour for free.
      var boolId = `field-${cardId}-${def.id}`;
      var boolBox = h('input', {
        type: 'checkbox',
        id: boolId,
        class: 'check-box',
        onChange: function (e) {
          postField(cardId, def.id, e.target.checked === true);
        },
      });
      boolBox.checked = on;
      return h('div', { class: 'field-bool' }, [
        boolBox,
        h('label', { class: 'field-bool-label', for: boolId }, on ? 'Yes' : 'No'),
      ]);
    }

    if (def.type === 'select') {
      var options = def.options || [];
      var known = val != null && val !== '' && options.indexOf(String(val)) !== -1;
      var unknown = val != null && val !== '' && !known;
      var optionNodes = [h('option', { value: '' }, '')];
      options.forEach(function (opt) {
        optionNodes.push(h('option', { value: opt }, opt));
      });
      if (unknown) {
        optionNodes.push(h('option', { value: String(val) }, `${String(val)} (unknown)`));
      }
      var select = h(
        'select',
        {
          class: `field-select${unknown ? ' unknown' : ''}`,
          onChange: function (e) {
            var v = e.target.value;
            postField(cardId, def.id, v === '' ? null : v);
          },
        },
        optionNodes,
      );
      select.value = val != null ? String(val) : '';
      return select;
    }

    if (def.type === 'multiselect') {
      var current = Array.isArray(val) ? val.slice() : [];
      var chips = (def.options || []).map(function (opt) {
        var selected = current.indexOf(opt) !== -1;
        return h(
          'span',
          {
            class: `ms-chip${selected ? ' on' : ''}`,
            style: selected ? tintVar('--vscode-focusBorder') : null,
            onClick: function () {
              var next = current.slice();
              var idx = next.indexOf(opt);
              if (idx === -1) {
                next.push(opt);
              } else {
                next.splice(idx, 1);
              }
              postField(cardId, def.id, next.length ? next : null);
            },
          },
          opt,
        );
      });
      return h('div', { class: 'ms-chips' }, chips);
    }

    // text | number | date
    var type = def.type === 'number' ? 'number' : def.type === 'date' ? 'date' : 'text';
    var input = h('input', {
      type: type,
      class: 'field-input',
      onChange: function (e) {
        var raw = String(e.target.value).trim();
        if (raw === '') {
          postField(cardId, def.id, null);
          return;
        }
        if (def.type === 'number') {
          var n = Number(raw);
          postField(cardId, def.id, isNaN(n) ? null : n);
        } else {
          postField(cardId, def.id, raw);
        }
      },
    });
    input.value = val != null ? String(val) : '';
    return input;
  }

  function modalFields(card) {
    var defs = fieldDefs();
    if (!defs.length || !can('fields')) {
      return null;
    }
    var rows = defs.map(function (def) {
      return h('div', { class: 'field-row' }, [
        h('div', { class: 'field-row-label' }, fieldLabel(def)),
        fieldEditor(def, card),
      ]);
    });
    return h('div', { class: 'section' }, [
      h('div', { class: 'field-label' }, 'Fields'),
      h('div', { class: 'fields-grid' }, rows),
    ]);
  }

  // Human note under a gate row (requirement when unmet, evidence when met).
  function gateNote(card, def, sat) {
    if (def.field) {
      var name = fieldDisplayName(def.field);
      if (sat) {
        var val = fieldValue(card, def.field);
        var shown = Array.isArray(val) ? val.join(', ') : String(val == null ? '' : val);
        return shown ? `${name}: ${shown}` : `${name} set`;
      }
      return `Requires ${name} ${describeCheck(def.check)}`;
    }
    if (def.script) {
      if (sat) {
        var e = gateEvidence(card, def.id);
        return e?.note ? e.note : 'Passed';
      }
      return `Run: ${def.script}`;
    }
    return '';
  }

  function recordGatePass(cardId, gateId) {
    var key = `${cardId}|${gateId}`;
    var text = String(gatePassText[key] || '').trim();
    if (!text) {
      return;
    }
    vscode.postMessage({
      type: 'recordGatePass',
      cardId: cardId,
      gateId: gateId,
      result: text,
    });
    gatePassText[key] = '';
    // The host echo re-renders and the row turns green in place.
  }

  /**
   * The kind-specific action that SATISFIES a gate, used by both the blocked-
   * move dialog and the card modal's Gates section. `gate` may be a config
   * GateDef or a MoveBlockedGate — both carry id/script/field/check.
   */
  function gateAction(card, gate) {
    if (gate.script) {
      var cmdRow = h('div', { class: 'gate-cmd-row' }, [
        h('code', { class: 'gate-cmd' }, gate.script),
        h(
          'button',
          {
            class: 'ghost-btn',
            'aria-label': 'Copy the command',
            onClick: function () {
              copyText(gate.script);
            },
          },
          'Copy',
        ),
      ]);
      if (!can('gateEvidence')) {
        return h('div', { class: 'gate-action' }, [
          cmdRow,
          h('div', { class: 'gate-hint' }, 'Record the result in the card file.'),
        ]);
      }
      var key = `${card.id}|${gate.id}`;
      var input = h('input', {
        id: `gatepass-${gate.id}`,
        class: 'field-input',
        placeholder: 'What ran and what happened, e.g. bun test green, 130 unit + 9 e2e',
        'aria-label': 'Result of the run',
        onInput: function (e) {
          gatePassText[key] = e.target.value; // no render
        },
        onKeyDown: function (e) {
          if (e.key === 'Enter') {
            e.preventDefault();
            recordGatePass(card.id, gate.id);
          }
        },
      });
      input.value = gatePassText[key] || '';
      return h('div', { class: 'gate-action' }, [
        cmdRow,
        h('div', { class: 'gate-record-row' }, [
          input,
          h(
            'button',
            {
              class: 'btn-primary',
              onClick: function () {
                recordGatePass(card.id, gate.id);
              },
            },
            'Record',
          ),
        ]),
        h('div', { class: 'gate-hint' }, 'Only record a run that actually passed.'),
      ]);
    }

    // Field gate. When the board declares the field, edit it right here rather
    // than pointing at the Fields section.
    var children = [];
    var def = fieldDefById(gate.field);
    if (def && can('fields')) {
      children.push(
        h('div', { class: 'gate-field-row' }, [
          h('div', { class: 'field-row-label' }, fieldLabel(def)),
          fieldEditor(def, card),
        ]),
      );
    } else {
      var current = fieldValue(card, gate.field);
      var shown = isPresent(current)
        ? Array.isArray(current)
          ? current.join(', ')
          : String(current)
        : 'unset';
      children.push(
        h('div', { class: 'gate-hint' }, `${fieldDisplayName(gate.field)} is currently ${shown}.`),
      );
    }
    if (isSignOffField(gate.field)) {
      children.push(
        h(
          'div',
          { class: 'gate-hint' },
          'This is a sign-off — set it only if you are the reviewer.',
        ),
      );
    }
    return h('div', { class: 'gate-action' }, children);
  }

  // Host-rendered prompt HTML for a gate on a column transition.
  function gatePromptHtmlFor(colId, dir, gateId) {
    var map = state.data?.gatePromptHtml;
    var key = `${colId}:${dir}:${gateId}`;
    return map?.[key] ? map[key] : null;
  }

  // Mirrors nextColumnId() in src/panels/gateGuidance.ts — kept in sync by hand.
  function nextColumnOf(col) {
    var b = board();
    if (!b || !col) {
      return null;
    }
    for (var i = 0; i < b.columns.length; i++) {
      if (b.columns[i].id === col.id) {
        return i + 1 < b.columns.length ? b.columns[i + 1] : null;
      }
    }
    return null;
  }

  /**
   * The move this card can make next, and what stands in its way — shared by
   * the modal's status row and the Gates section so they never disagree.
   * Null when the card is already in the last column.
   */
  function nextMoveState(card, col) {
    var next = nextColumnOf(col);
    if (!next) {
      return null;
    }
    var blocking = (col?.exit || []).concat(next.enter || []);
    // Gates are only enforced where evidence has a home — a feature set has no
    // sidecar, so its moves are never gate-blocked (CHANGELOG 0.9.0) and the
    // button must not pretend otherwise.
    var unmet = can('gateEvidence')
      ? blocking.filter(function (def) {
          return !gateSatisfied(card, def);
        })
      : [];
    return { next: next, blocking: blocking, unmet: unmet, ok: unmet.length === 0 };
  }

  function moveToNext(card, next) {
    state.lastMove = { cardId: card.id, toColumn: next.id, index: MOVE_TO_END };
    vscode.postMessage({
      type: 'moveCard',
      cardId: card.id,
      toColumn: next.id,
      index: MOVE_TO_END,
    });
    closeModal();
  }

  /** The Gates section, scrolled into view from the header's hint. */
  function revealGates() {
    var section = document.getElementById('gates-section');
    if (section) {
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function gateRow(card, def, colId, dir) {
    var sat = gateSatisfied(card, def);
    var status = sat
      ? h('span', { class: 'gate-status ok', html: ICON.check })
      : h('span', { class: 'gate-status' });
    var main = [
      h('div', { class: 'gate-label' }, [gateLabel(def), h('span', { class: 'gate-id' }, def.id)]),
      h('div', { class: 'gate-note' }, gateNote(card, def, sat)),
    ];
    if (!sat) {
      var key = `${colId}:${dir}:${def.id}`;
      var open = state.openGateHow[key] === true;
      main.push(
        h(
          'button',
          {
            class: 'disclosure',
            'aria-expanded': open ? 'true' : 'false',
            onClick: function () {
              state.openGateHow[key] = !open;
              render();
            },
          },
          `${open ? '▾ ' : '▸ '}How to satisfy`,
        ),
      );
      if (open) {
        main.push(
          contentBlock('gate-prompt', gatePromptHtmlFor(colId, dir, def.id), def.prompt || ''),
        );
        main.push(gateAction(card, def));
      }
    }
    return h('div', { class: 'gate-row' }, [status, h('div', { class: 'gate-main' }, main)]);
  }

  function gateGroupNode(card, grp) {
    return h('div', { class: 'gate-group' }, [
      h('div', { class: 'gate-group-head' }, grp.heading),
      h(
        'div',
        { class: 'gate-list' },
        grp.gates.map(function (def) {
          return gateRow(card, def, grp.colId, grp.dir);
        }),
      ),
    ]);
  }

  /**
   * Surface 2 — the gates a human meets BEFORE the drag. D-6: show the exit
   * gates of this column and the enter gates of the NEXT one by default;
   * everything else is behind "Show all transitions".
   */
  function modalGates(card, col) {
    var b = board();
    var next = nextColumnOf(col);
    var primary = [];
    if (col?.exit?.length) {
      primary.push({
        heading: `To leave ${col.name}`,
        colId: col.id,
        dir: 'exit',
        gates: col.exit,
      });
    }
    if (next?.enter?.length) {
      primary.push({
        heading: `To enter ${next.name}`,
        colId: next.id,
        dir: 'enter',
        gates: next.enter,
      });
    }
    var others = [];
    (b.columns || []).forEach(function (c) {
      if ((col && c.id === col.id) || (next && c.id === next.id)) {
        return;
      }
      if (c.enter?.length) {
        others.push({ heading: `To enter ${c.name}`, colId: c.id, dir: 'enter', gates: c.enter });
      }
    });
    // Gates are only enforced where evidence has a home (Decision 10): a feature
    // set shows no gate rows, only the keyboard move below.
    if (!can('gateEvidence')) {
      primary = [];
      others = [];
    }
    if (!primary.length && !others.length && !next) {
      return null;
    }

    var shown = primary.concat(state.showAllGates ? others : []);
    var children = shown.length
      ? [
          h('div', { class: 'field-label' }, 'Gates'),
          h(
            'div',
            { class: 'gates' },
            shown.map(function (grp) {
              return gateGroupNode(card, grp);
            }),
          ),
        ]
      : [];

    if (others.length) {
      children.push(
        h(
          'button',
          {
            class: 'disclosure',
            'aria-expanded': state.showAllGates ? 'true' : 'false',
            onClick: function () {
              state.showAllGates = !state.showAllGates;
              render();
            },
          },
          `${state.showAllGates ? '▾ ' : '▸ '}Show all transitions`,
        ),
      );
    }

    // A keyboard-reachable move that does not need drag and drop. Enabled when
    // every gate on THIS transition passes; the host re-validates regardless.
    var move = nextMoveState(card, col);
    if (move) {
      children.push(moveNextButton(card, move, 'btn-primary move-next'));
    }

    return h('div', { class: 'section', id: 'gates-section' }, children);
  }

  /** The "Move to <next>" button, gated by {@link nextMoveState}. */
  function moveNextButton(card, move, className) {
    return h(
      'button',
      {
        class: className,
        disabled: move.ok ? null : 'disabled',
        title: move.ok
          ? `Move to ${move.next.name}`
          : `${move.unmet.length} gate${move.unmet.length === 1 ? '' : 's'} must be satisfied first`,
        onClick: move.ok
          ? function () {
              moveToNext(card, move.next);
            }
          : null,
      },
      `Move to ${move.next.name}`,
    );
  }

  /**
   * A compact "where is this and what is next" row under the card title: the
   * column it is in, the move it can make, and — when gates block that move —
   * a one-line hint that takes a human to them.
   */
  function modalStatusRow(card, col) {
    var children = [h('span', { class: 'col-badge' }, col ? col.name : '')];
    var move = nextMoveState(card, col);
    if (move) {
      children.push(moveNextButton(card, move, 'btn-secondary move-next-inline'));
      if (move.unmet.length) {
        children.push(
          h(
            'button',
            {
              class: 'disclosure status-row-hint-btn',
              title: 'Show the gates for this move',
              onClick: revealGates,
            },
            `${move.unmet.length} gate${move.unmet.length === 1 ? '' : 's'} to satisfy`,
          ),
        );
      }
    }
    return h('div', { class: 'modal-status-row' }, children);
  }

  function buildModal() {
    var card = board().cards[state.openCardId];
    if (!card) {
      return null;
    }
    var col = columnOfCard(state.openCardId);

    var body = [
      modalColumnPrompt(card, col),
      activityRow(card),
      modalMeta(card),
      modalDescription(card),
      modalScenarios(card),
      modalFields(card),
      modalChecklist(card),
      modalGates(card, col),
      modalComments(card),
    ];

    var panel = h(
      'div',
      {
        class: modalWidthClass(),
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': card.title,
        tabindex: '-1',
        style: modalWidthStyle(),
        onClick: function (e) {
          e.stopPropagation();
        },
      },
      [modalHead(card, col), h('div', { class: 'modal-body' }, body)],
    );

    return h('div', { class: 'modal-overlay', onClick: closeModal }, [panel]);
  }

  function closeModal() {
    state.openCardId = null;
    state.editingTitle = false;
    state.editingDesc = false;
    state.addingCheck = false;
    // Unsaved scenario text is NOT dropped here: like a comment draft, it
    // belongs to the card it was typed on and comes back when it is reopened.
    confirmRemoveKey = null;
    render();
  }

  /* ---- Blocked-move dialog (Surface 1: the moment of refusal) ---- */
  function closeBlocked() {
    state.blocked = null;
    overrideReason = '';
    render();
  }

  // Re-send the stashed attempt. Without override this is the "I did the work"
  // path; with override the host records a reason against every failing gate.
  function retryMove(override, reason) {
    var lm = state.lastMove;
    state.blocked = null;
    overrideReason = '';
    if (lm) {
      var msg = {
        type: 'moveCard',
        cardId: lm.cardId,
        toColumn: lm.toColumn,
        index: lm.index,
      };
      if (override) {
        msg.override = true;
        msg.reason = reason;
      }
      vscode.postMessage(msg);
    }
    render();
  }

  function overrideMove() {
    var why = overrideReason.trim();
    if (!why) {
      return; // the reason is required, exactly as the CLI requires --reason
    }
    retryMove(true, why);
  }

  // Client-side re-evaluation of a blocked gate against the CURRENT card, so a
  // row turns green as soon as evidence lands or a field is set.
  function blockedGateSatisfied(card, r) {
    if (!card) {
      return false;
    }
    return gateSatisfied(card, { id: r.id, script: r.script, field: r.field, check: r.check });
  }

  // Toggle the override button without a re-render, so the reason input keeps
  // focus while typing.
  function syncOverrideButton() {
    var btn = document.getElementById('override-move-btn');
    if (!btn) {
      return;
    }
    if (overrideReason.trim()) {
      btn.removeAttribute('disabled');
    } else {
      btn.setAttribute('disabled', 'disabled');
    }
  }

  function buildBlockedDialog() {
    var bl = state.blocked;
    if (!bl) {
      return null;
    }
    var b = board();
    var card = b ? b.cards[bl.cardId] : null;
    var col = columnById(bl.toColumn);
    var name = col ? col.name : bl.toColumn;
    var results = bl.results || [];

    var rows = results.map(function (r) {
      var sat = blockedGateSatisfied(card, r);
      var main = [
        h('div', { class: 'gate-label' }, [r.label, h('span', { class: 'gate-id' }, r.id)]),
        h('div', { class: 'gate-note' }, sat ? 'Satisfied' : r.reason),
      ];
      if (!sat) {
        if (r.promptHtml || r.prompt) {
          main.push(contentBlock('gate-prompt', r.promptHtml, r.prompt || ''));
        }
        if (card) {
          main.push(gateAction(card, r));
        }
      }
      return h('div', { class: 'blocked-gate' }, [
        sat
          ? h('span', { class: 'gate-status ok', html: ICON.check })
          : h('span', { class: 'gate-status' }),
        h('div', { class: 'gate-main' }, main),
      ]);
    });

    var allOk = results.every(function (r) {
      return blockedGateSatisfied(card, r);
    });

    var bodyChildren = [
      h(
        'div',
        { class: 'blocked-lead' },
        `${results.length + (results.length === 1 ? ' gate' : ' gates')} must be satisfied first`,
      ),
      h('div', { class: 'blocked-gates' }, rows),
    ];

    if (bl.overriding) {
      var reasonInput = h('input', {
        id: 'override-reason',
        class: 'field-input',
        placeholder: 'Why are you bypassing these gates?',
        'aria-label': 'Override reason',
        onInput: function (e) {
          overrideReason = e.target.value; // no render
          syncOverrideButton();
        },
        onKeyDown: function (e) {
          if (e.key === 'Enter') {
            e.preventDefault();
            overrideMove();
          }
        },
      });
      reasonInput.value = overrideReason;
      bodyChildren.push(
        h('div', { class: 'override-box' }, [
          h('div', { class: 'field-label' }, 'Reason (required)'),
          reasonInput,
          h('div', { class: 'gate-hint' }, 'Only a human may override — say why.'),
        ]),
      );
    } else {
      bodyChildren.push(
        h('div', { class: 'blocked-foot-note' }, 'Do the work above, then move again.'),
      );
    }

    var actions = [h('button', { class: 'btn-cancel-text', onClick: closeBlocked }, 'Cancel')];
    if (bl.overriding) {
      actions.push(
        h(
          'button',
          {
            id: 'override-move-btn',
            class: 'btn-secondary',
            disabled: overrideReason.trim() ? null : 'disabled',
            onClick: overrideMove,
          },
          'Override & move',
        ),
      );
    } else {
      actions.push(
        h(
          'button',
          {
            class: 'btn-secondary',
            onClick: function () {
              state.blocked.overriding = true;
              overrideReason = '';
              render();
            },
          },
          'Override…',
        ),
      );
    }
    actions.push(
      h(
        'button',
        {
          class: 'btn-primary',
          disabled: allOk ? null : 'disabled',
          title: allOk ? 'Move now' : 'Satisfy every gate above first',
          onClick: allOk
            ? function () {
                retryMove(false);
              }
            : null,
        },
        'Move',
      ),
    );
    bodyChildren.push(h('div', { class: 'blocked-actions' }, actions));

    var wide = results.some(function (r) {
      return !!(r.promptHtml || r.prompt);
    });
    var title = `Before ${card ? card.title : bl.cardId} can move to ${name}`;

    var panel = h(
      'div',
      {
        class: `modal blocked-modal${wide ? ' blocked-wide' : ''}`,
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': title,
        tabindex: '-1',
        onClick: function (e) {
          e.stopPropagation();
        },
      },
      [
        h('div', { class: 'modal-head' }, [
          h('div', { class: 'modal-head-row' }, [
            h('div', { class: 'modal-head-main' }, [
              h('div', { class: 'modal-title blocked-title' }, title),
            ]),
            h(
              'button',
              { class: 'modal-close', 'aria-label': 'Close', onClick: closeBlocked },
              '✕',
            ),
          ]),
        ]),
        h('div', { class: 'modal-body' }, bodyChildren),
      ],
    );
    return h('div', { class: 'modal-overlay', onClick: closeBlocked }, [panel]);
  }

  /* ---- Drag & drop ---- */
  function ensurePlaceholder() {
    if (!drag.placeholder) {
      drag.placeholder = h('div', { class: 'placeholder' });
    }
    return drag.placeholder;
  }

  function clearColumnHighlights() {
    var cols = document.querySelectorAll('.column.drag-target');
    for (var i = 0; i < cols.length; i++) {
      cols[i].classList.remove('drag-target');
    }
  }

  function highlightColumn(colEl) {
    clearColumnHighlights();
    if (colEl) {
      colEl.classList.add('drag-target');
    }
  }

  function onCardDragStart(e, cardId, cardEl) {
    drag.active = true;
    drag.cardId = cardId;
    drag.el = cardEl;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      try {
        e.dataTransfer.setData('text/plain', cardId);
      } catch (_err) {
        /* ignore */
      }
    }
    ensurePlaceholder();
    // Defer adding the dragging class so the drag image captures the full card.
    setTimeout(function () {
      if (drag.active && drag.el) {
        drag.el.classList.add('dragging');
      }
    }, 0);
  }

  function onCardDragOver(e, cardEl) {
    if (!drag.active) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }
    var list = cardEl.parentElement;
    if (!list) {
      return;
    }
    var ph = ensurePlaceholder();
    var r = cardEl.getBoundingClientRect();
    var before = e.clientY < r.top + r.height / 2;
    if (before) {
      list.insertBefore(ph, cardEl);
    } else {
      list.insertBefore(ph, cardEl.nextSibling);
    }
    var colEl = list.closest('.column');
    highlightColumn(colEl);
  }

  function onColumnDragOver(e, colEl, list) {
    if (!drag.active) {
      return;
    }
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }
    var ph = ensurePlaceholder();
    // Only append when the placeholder is not already in this list (empty area / gaps).
    if (ph.parentElement !== list) {
      list.appendChild(ph);
    }
    highlightColumn(colEl);
  }

  // The DOM only shows cards passing the active search filter, so a DOM
  // position is not a valid index into the column's full card list. Anchor the
  // drop on the first visible card after the placeholder, then find its slot
  // among ALL of the column's cards (minus the dragged one).
  function absoluteDropIndex(nextVisibleCardId, columnCardIds, draggedCardId) {
    var remaining = columnCardIds.filter(function (id) {
      return id !== draggedCardId;
    });
    var anchor = nextVisibleCardId ? remaining.indexOf(nextVisibleCardId) : -1;
    return anchor >= 0 ? anchor : remaining.length;
  }

  // Walk the list DOM to find the first real card after the placeholder.
  function nextVisibleCardAfterPlaceholder(list, ph) {
    var seenPh = false;
    var kids = list.children;
    for (var i = 0; i < kids.length; i++) {
      var child = kids[i];
      if (child === ph) {
        seenPh = true;
        continue;
      }
      if (seenPh && child.classList.contains('card') && child !== drag.el) {
        return child.dataset.cardId;
      }
    }
    return null;
  }

  function columnById(colId) {
    var b = board();
    if (!b) {
      return null;
    }
    for (var c = 0; c < b.columns.length; c++) {
      if (b.columns[c].id === colId) {
        return b.columns[c];
      }
    }
    return null;
  }

  function onColumnDrop(e) {
    if (!drag.active) {
      return;
    }
    e.preventDefault();
    var ph = drag.placeholder;
    if (!ph?.parentElement) {
      onDragEnd();
      return;
    }
    var list = ph.parentElement;
    var colId = list.dataset.colId;
    var targetCol = columnById(colId);
    var index = targetCol
      ? absoluteDropIndex(nextVisibleCardAfterPlaceholder(list, ph), targetCol.cardIds, drag.cardId)
      : 0;
    var cardId = drag.cardId;
    cleanupDrag();
    // Stash the attempt so a blocked-move dialog can retry it with override.
    state.lastMove = { cardId: cardId, toColumn: colId, index: index };
    vscode.postMessage({ type: 'moveCard', cardId: cardId, toColumn: colId, index: index });
    // The resulting {type:'data'} message re-renders; a gate block replies with
    // {type:'moveBlocked'} instead and the card stays put.
  }

  function onDragEnd() {
    cleanupDrag();
    if (drag.pendingData) {
      var pending = drag.pendingData;
      drag.pendingData = null;
      applyData(pending);
    }
  }

  function cleanupDrag() {
    if (drag.placeholder?.parentElement) {
      drag.placeholder.parentElement.removeChild(drag.placeholder);
    }
    if (drag.el) {
      drag.el.classList.remove('dragging');
    }
    clearColumnHighlights();
    drag.active = false;
    drag.cardId = null;
    drag.el = null;
    drag.placeholder = null;
  }

  /* ---- Render ---- */
  // Which dialog last received focus, so a data refresh does not keep stealing
  // it back (D-4: focus the panel when it OPENS).
  var focusedDialog = null;

  // D-4: Escape closes the blocked dialog first, then the card modal. The two
  // composers still own Escape while they are focused (they cancel themselves).
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') {
      return;
    }
    if (state.blocked) {
      e.preventDefault();
      closeBlocked();
      return;
    }
    if (!state.openCardId) {
      return;
    }
    var target = e.target;
    if (target?.closest?.('input, textarea, select')) {
      return; // the focused editor handles its own Escape
    }
    e.preventDefault();
    closeModal();
  });

  function render() {
    if (drag.active) {
      return; // never re-render mid-drag
    }
    var app = document.getElementById('app');
    if (!app) {
      return;
    }

    // Preserve focus + caret across the rebuild for ANY identified field —
    // search, the inline gate-evidence inputs, the override reason.
    var active = document.activeElement;
    var activeId = active?.id ? active.id : null;
    var caretStart = 0;
    var caretEnd = 0;
    try {
      if (active && typeof active.selectionStart === 'number') {
        caretStart = active.selectionStart;
        caretEnd = active.selectionEnd;
      }
    } catch (_caretErr) {
      /* number/date inputs expose no selection */
    }

    if (!state.data) {
      while (app.firstChild) {
        app.removeChild(app.firstChild);
      }
      return;
    }

    // Drop a stale open card, and any scenario text typed on it — the file it
    // belonged to is gone, so there is nowhere left to save it.
    if (state.openCardId && !board().cards[state.openCardId]) {
      scenarioDrafts = clearCardDrafts(scenarioDrafts, boardIdOf(), state.openCardId);
      state.openCardId = null;
    }
    // ...and a blocked dialog whose card disappeared underneath it.
    if (state.blocked && !board().cards[state.blocked.cardId]) {
      state.blocked = null;
    }

    // Build into a detached fragment FIRST. If any builder throws on an
    // unexpected card shape, the current board stays on screen instead of
    // going blank and freezing every later action.
    var frag = document.createDocumentFragment();
    try {
      frag.appendChild(buildTopBar());
      frag.appendChild(buildCanvas());
      frag.appendChild(buildStatusBar());
      if (state.openCardId) {
        var modal = buildModal();
        if (modal) {
          frag.appendChild(modal);
        }
      }
      if (state.blocked) {
        var dialog = buildBlockedDialog();
        if (dialog) {
          frag.appendChild(dialog);
        }
      }
    } catch (buildErr) {
      // Keep the previous DOM; surface the failure for diagnosis.
      // eslint-disable-next-line no-console
      console.error('RepoDoc: board render failed', buildErr);
      return;
    }

    while (app.firstChild) {
      app.removeChild(app.firstChild);
    }
    app.appendChild(frag);

    // Enhance host-rendered content blocks in place (file links + diagrams).
    try {
      enhanceContentBlocks(app);
    } catch (enhanceErr) {
      // eslint-disable-next-line no-console
      console.error('RepoDoc: content enhancement failed', enhanceErr);
    }

    // The overflow fade depends on layout, so it is set once the strip is in
    // the document (and again on every scroll / resize).
    syncCanvasOverflow();

    restoreFocus(activeId, caretStart, caretEnd);
  }

  function focusEnd(el) {
    if (!el) {
      return false;
    }
    el.focus();
    try {
      var len = el.value.length;
      el.setSelectionRange(len, len);
    } catch (_err) {
      /* not a text field */
    }
    return true;
  }

  /**
   * Focus, in priority order: whatever was focused before the rebuild, then a
   * composer/editor that was just opened, then — when a dialog has just
   * appeared — the dialog itself (D-4).
   */
  function restoreFocus(activeId, caretStart, caretEnd) {
    if (activeId) {
      var previous = document.getElementById(activeId);
      if (previous) {
        previous.focus();
        try {
          previous.setSelectionRange(caretStart, caretEnd);
        } catch (_err) {
          /* ignore */
        }
        return;
      }
    }
    if (state.addingCol && focusEnd(document.getElementById(`composer-${state.addingCol}`))) {
      return;
    }
    if (state.editingTitle && focusEnd(document.getElementById('title-input'))) {
      return;
    }
    if (state.editingDesc && focusEnd(document.getElementById('desc-editor'))) {
      return;
    }
    if (state.addingCheck && focusEnd(document.getElementById('check-composer'))) {
      return;
    }
    if (focusScenario) {
      var field = document.getElementById(focusScenario);
      focusScenario = null;
      if (focusEnd(field)) {
        return;
      }
    }
    var want = state.blocked ? 'blocked' : state.openCardId ? 'modal' : null;
    if (want !== focusedDialog) {
      focusedDialog = want;
      if (want) {
        var panel = document.querySelector(
          want === 'blocked' ? '.blocked-modal' : '.modal:not(.blocked-modal)',
        );
        if (panel) {
          panel.focus();
        }
      }
    }
  }

  function applyData(payload) {
    state.data = payload;
    // Confirm posted scenario edits against what the file now says BEFORE the
    // render, so a block that landed shows "Saved" in the same frame.
    try {
      reconcileScenarioSaves();
    } catch (saveErr) {
      // eslint-disable-next-line no-console
      console.error('RepoDoc: scenario save reconciliation failed', saveErr);
    }
    render();
  }

  /* ---- Messaging ---- */
  window.addEventListener('message', function (event) {
    try {
      handleMessage(event.data);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('RepoDoc: message handling failed', err);
    }
  });

  function handleMessage(msg) {
    if (!msg) {
      return;
    }
    if (msg.type === 'bounce' && msg.message) {
      vscode.postMessage(msg.message); // test/automation echo via the real channel
      return;
    }
    if (msg.type === 'openCard' && typeof msg.cardId === 'string') {
      // Host-driven card open (tests / automation) — mirrors a card click.
      state.openCardId = msg.cardId;
      if (state.data) {
        render();
      }
      return;
    }
    if (msg.type === 'moveBlocked' && typeof msg.cardId === 'string') {
      // A gated move was refused; surface the unmet gates with an override path.
      // The drop already ended, so drag.active is false — safe to render now.
      overrideReason = '';
      state.blocked = {
        cardId: msg.cardId,
        toColumn: msg.toColumn,
        results: Array.isArray(msg.results) ? msg.results : [],
        overriding: false,
      };
      if (state.data) {
        render();
      }
      return;
    }
    if (msg.type !== 'data') {
      return;
    }
    if (drag.active) {
      drag.pendingData = msg; // apply after the drag finishes
      return;
    }
    applyData(msg);
  }

  vscode.postMessage({ type: 'ready' });
})();
