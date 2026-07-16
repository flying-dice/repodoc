/* RepoDoc kanban board webview — plain browser ES2020, no build step. */
(function () {
  'use strict';

  var vscode = acquireVsCodeApi();

  /* ---- Local UI state (survives data re-renders) ---- */
  var state = {
    data: null, // { boardId, board, config, dataDirName }
    query: '',
    filterAgent: null,
    addingCol: null, // column id currently showing the composer
    openCardId: null,
  };

  var addText = ''; // uncontrolled composer text; never triggers a render

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
    search:
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8a8f98" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.2-3.2"></path></svg>',
    checklist:
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"></path><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>',
    fileMeta:
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><path d="M13 2v7h7"></path></svg>',
    comment:
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>',
    fileModal:
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#7d828b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><path d="M13 2v7h7"></path></svg>',
    check:
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>',
  };

  /* ---- Helpers ---- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  var EVT = {
    onClick: 'click',
    onInput: 'input',
    onKeyDown: 'keydown',
    onDragStart: 'dragstart',
    onDragEnd: 'dragend',
    onDragOver: 'dragover',
    onDrop: 'drop',
    onMouseDown: 'mousedown',
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
          node.innerHTML = val; // trusted static SVG strings only
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
      return mins + 'm';
    }
    var hours = Math.floor(mins / 60);
    if (hours < 24) {
      return hours + 'h';
    }
    var days = Math.floor(hours / 24);
    if (days < 7) {
      return days + 'd';
    }
    return Math.floor(days / 7) + 'w';
  }

  function basename(p) {
    return String(p || '')
      .replace(/\/+$/, '')
      .split('/')
      .pop();
  }

  function matches(card) {
    var q = state.query.trim().toLowerCase();
    if (q && card.title.toLowerCase().indexOf(q) === -1) {
      return false;
    }
    if (state.filterAgent && card.agent !== state.filterAgent) {
      return false;
    }
    return true;
  }

  function board() {
    return state.data ? state.data.board : null;
  }
  function config() {
    return state.data ? state.data.config : { labels: {}, agents: {} };
  }
  function agentDef(key) {
    var agents = config().agents || {};
    return key && agents[key] ? agents[key] : null;
  }
  function labelDef(key) {
    var labels = config().labels || {};
    return key && labels[key] ? labels[key] : null;
  }

  function subtaskProgress(card) {
    if (card.checklist && card.checklist.length) {
      var done = 0;
      for (var i = 0; i < card.checklist.length; i++) {
        if (card.checklist[i].done) {
          done++;
        }
      }
      return { done: done, total: card.checklist.length };
    }
    if (card.subtasks && card.subtasks.total) {
      return { done: card.subtasks.done, total: card.subtasks.total };
    }
    return null;
  }

  /* ---- Top bar ---- */
  function buildTopBar() {
    var b = board();
    var cfg = config();

    var crumb = h('div', { class: 'crumb' }, [
      h('span', { class: 'crumb-section' }, 'Boards'),
      h('span', { class: 'crumb-sep' }, '/'),
      h('span', { class: 'crumb-leaf' }, b ? b.name : ''),
    ]);

    var searchInput = h('input', {
      id: 'search-input',
      placeholder: 'Search cards',
      value: state.query,
      onInput: function (e) {
        state.query = e.target.value;
        render();
      },
    });
    var search = h('div', { class: 'search' }, [icon(ICON.search), searchInput]);

    var chips = [];
    var agents = cfg.agents || {};
    Object.keys(agents).forEach(function (key) {
      var a = agents[key];
      var on = state.filterAgent === key;
      var style =
        'background:' +
        a.color +
        ';opacity:' +
        (state.filterAgent && !on ? '0.35' : '1') +
        ';box-shadow:' +
        (on ? '0 0 0 2px #181a1e, 0 0 0 4px ' + a.color : 'none') +
        ';';
      chips.push(
        h(
          'div',
          {
            class: 'chip',
            style: style,
            title: a.name,
            onClick: function () {
              state.filterAgent = on ? null : key;
              render();
            },
          },
          a.initials,
        ),
      );
    });

    var right = h('div', { class: 'topbar-right' }, [
      search,
      h('div', { class: 'chips' }, chips),
    ]);

    return h('div', { class: 'topbar' }, [crumb, h('div', { class: 'topbar-spacer' }), right]);
  }

  /* ---- Label chip ---- */
  function labelChip(key) {
    var l = labelDef(key);
    if (!l) {
      return null;
    }
    var style =
      'color:' + l.color + ';background:' + l.color + '22;border:1px solid ' + l.color + '44;';
    return h('span', { class: 'label-chip', style: style }, l.name);
  }

  /* ---- Card ---- */
  function buildCard(cardId, card) {
    var children = [];

    if (card.labels && card.labels.length) {
      var chips = card.labels.map(labelChip).filter(Boolean);
      if (chips.length) {
        children.push(h('div', { class: 'card-labels' }, chips));
      }
    }

    var titleRow = [];
    if (card.priority === 'high' || card.priority === 'med') {
      var pColor = card.priority === 'high' ? '#e5534b' : '#d99a30';
      var pGlow =
        card.priority === 'high' ? 'rgba(229,83,75,.18)' : 'rgba(217,154,48,.16)';
      titleRow.push(
        h('span', {
          class: 'priority-dot',
          title: 'Priority',
          style: 'background:' + pColor + ';box-shadow:0 0 0 3px ' + pGlow + ';',
        }),
      );
    }
    titleRow.push(h('div', { class: 'card-title' }, card.title));
    children.push(h('div', { class: 'card-titlerow' }, titleRow));

    if (card.live) {
      var pct = (card.progress || 0) + '%';
      children.push(
        h('div', { class: 'live-block' }, [
          h('div', { class: 'live-row' }, [
            h('span', { class: 'live-dot' }),
            h('span', { class: 'live-status' }, card.status || ''),
            h('span', { class: 'live-pct' }, pct),
          ]),
          h('div', { class: 'progress-track' }, [
            h('div', { class: 'progress-fill', style: 'width:' + pct + ';' }),
          ]),
        ]),
      );
    }

    var meta = [];
    var sub = subtaskProgress(card);
    if (sub) {
      meta.push(
        h('span', { class: 'meta-item' }, [
          icon(ICON.checklist, 'icon'),
          sub.done + '/' + sub.total,
        ]),
      );
    }
    if (card.files && card.files.length) {
      meta.push(
        h('span', { class: 'meta-item meta-file' }, [
          icon(ICON.fileMeta, 'icon'),
          basename(card.files[0]),
        ]),
      );
    }
    if (card.comments) {
      meta.push(
        h('span', { class: 'meta-item' }, [icon(ICON.comment, 'icon'), String(card.comments)]),
      );
    }
    meta.push(h('div', { class: 'meta-spacer' }));
    meta.push(h('span', { class: 'meta-updated' }, humanizeTime(card.updatedAt)));
    var ag = agentDef(card.agent);
    if (ag) {
      meta.push(
        h(
          'span',
          { class: 'meta-avatar', style: 'background:' + ag.color + ';', title: ag.name },
          ag.initials,
        ),
      );
    }
    children.push(h('div', { class: 'card-meta' }, meta));

    var cardEl = h(
      'div',
      {
        class: 'card',
        draggable: true,
        dataset: { cardId: cardId },
        onClick: function () {
          state.openCardId = cardId;
          render();
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
    for (var i = 0; i < col.cardIds.length; i++) {
      var c = b.cards[col.cardIds[i]];
      if (c && matches(c)) {
        visible.push({ id: col.cardIds[i], card: c });
      }
    }

    var head = [
      h('span', { class: 'col-dot', style: 'background:' + col.color + ';' }),
      h('span', { class: 'col-name' }, col.name),
      h('span', { class: 'col-count' }, String(visible.length)),
      h('div', { class: 'col-head-spacer' }),
    ];
    if (col.wip) {
      var over = visible.length > col.wip;
      head.push(
        h('span', { class: 'wip' + (over ? ' over' : '') }, visible.length + '/' + col.wip),
      );
    }

    var listChildren = visible.map(function (x) {
      return buildCard(x.id, x.card);
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
        id: 'composer-' + col.id,
        placeholder: 'Enter a title for this card...',
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
          'Add card',
        ),
        h('button', { class: 'btn-cancel', onClick: cancelComposer }, '✕'),
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
        [h('span', { class: 'plus' }, '+'), ' Add a card'],
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
    var cols = (b.columns || []).map(buildColumn);
    var addList = h('div', { class: 'add-list-wrap' }, [
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
    ]);
    var inner = h('div', { class: 'canvas-inner' }, cols.concat([addList]));
    return h('div', { class: 'canvas' }, [inner]);
  }

  /* ---- Status bar ---- */
  function buildStatusBar() {
    var b = board();
    var live = 0;
    var total = 0;
    (b.columns || []).forEach(function (col) {
      col.cardIds.forEach(function (id) {
        var c = b.cards[id];
        if (c) {
          total++;
          if (c.live) {
            live++;
          }
        }
      });
    });
    var dataDir = (state.data && state.data.dataDirName) || '';
    return h('div', { class: 'statusbar' }, [
      h('span', { class: 'status-live' }, [
        h('span', { class: 'status-live-dot' }),
        live + ' agents active',
      ]),
      h('span', {}, total + ' cards'),
      h('div', { class: 'status-spacer' }),
      h('span', { class: 'status-datadir' }, dataDir + '/'),
    ]);
  }

  /* ---- Card detail modal ---- */
  function buildModal() {
    var b = board();
    var card = b.cards[state.openCardId];
    if (!card) {
      return null;
    }
    var col = null;
    for (var i = 0; i < b.columns.length; i++) {
      if (b.columns[i].cardIds.indexOf(state.openCardId) !== -1) {
        col = b.columns[i];
        break;
      }
    }

    var badges = (card.labels || []).map(labelChip).filter(Boolean);
    badges.push(h('span', { class: 'col-badge' }, col ? col.name : ''));

    var head = h('div', { class: 'modal-head' }, [
      h('div', { class: 'modal-head-row' }, [
        h('div', { class: 'modal-head-main' }, [
          h('div', { class: 'modal-badges' }, badges),
          h('div', { class: 'modal-title' }, card.title),
        ]),
        h('button', { class: 'modal-close', onClick: closeModal }, '✕'),
      ]),
    ]);

    var body = [];

    if (card.live) {
      var ag = agentDef(card.agent);
      body.push(
        h('div', { class: 'modal-live' }, [
          h('span', { class: 'modal-live-dot' }),
          h('div', { class: 'modal-live-main' }, [
            h('div', { class: 'modal-live-status' }, card.status || ''),
            h(
              'div',
              { class: 'modal-live-sub' },
              (ag ? ag.name : 'Agent') + ' · ' + (card.progress || 0) + '% complete',
            ),
          ]),
        ]),
      );
    }

    var agDef = agentDef(card.agent);
    var assignee;
    if (agDef) {
      assignee = h('div', { class: 'assignee' }, [
        h(
          'span',
          { class: 'assignee-avatar', style: 'background:' + agDef.color + ';' },
          agDef.initials,
        ),
        h('span', { class: 'assignee-name' }, agDef.name),
      ]);
    } else {
      assignee = h('span', { class: 'unassigned' }, 'Unassigned');
    }
    var prColors = { high: '#e5534b', med: '#d99a30', low: '#7d828b' };
    var prLabels = { high: 'High', med: 'Medium', low: 'Low' };
    var prC = prColors[card.priority] || '#7d828b';
    var prL = prLabels[card.priority] || 'Medium';
    var priorityPill = h(
      'span',
      {
        class: 'priority-pill',
        style: 'color:' + prC + ';background:' + prC + '22;border:1px solid ' + prC + '44;',
      },
      prL,
    );
    body.push(
      h('div', { class: 'modal-cols' }, [
        h('div', {}, [h('div', { class: 'field-label' }, 'Assignee'), assignee]),
        h('div', {}, [h('div', { class: 'field-label' }, 'Priority'), priorityPill]),
      ]),
    );

    if (card.desc) {
      body.push(
        h('div', { class: 'section' }, [
          h('div', { class: 'field-label' }, 'Description'),
          h('div', { class: 'section-desc' }, card.desc),
        ]),
      );
    }

    if (card.checklist && card.checklist.length) {
      var done = 0;
      card.checklist.forEach(function (x) {
        if (x.done) {
          done++;
        }
      });
      var items = card.checklist.map(function (item, index) {
        var boxChildren = item.done ? [icon(ICON.check, 'icon')] : [];
        return h(
          'div',
          {
            class: 'check-item',
            onClick: function () {
              vscode.postMessage({
                type: 'toggleCheck',
                cardId: state.openCardId,
                index: index,
              });
            },
          },
          [
            h('span', { class: 'check-box' + (item.done ? ' done' : '') }, boxChildren),
            h('span', { class: 'check-text' + (item.done ? ' done' : '') }, item.text),
          ],
        );
      });
      body.push(
        h('div', { class: 'section' }, [
          h('div', { class: 'checklist-head' }, [
            h('div', { class: 'field-label', style: 'margin-bottom:0;' }, 'Checklist'),
            h('span', { class: 'checklist-count' }, done + '/' + card.checklist.length),
          ]),
          h('div', { class: 'checklist' }, items),
        ]),
      );
    }

    if (card.files && card.files.length) {
      var fileChips = card.files.map(function (f) {
        return h(
          'button',
          {
            class: 'file-chip',
            onClick: function () {
              vscode.postMessage({ type: 'openFile', path: f });
            },
          },
          [icon(ICON.fileModal, 'icon'), f],
        );
      });
      body.push(
        h('div', { class: 'section' }, [
          h('div', { class: 'field-label' }, 'Files touched'),
          h('div', { class: 'files-list' }, fileChips),
        ]),
      );
    }

    var panel = h(
      'div',
      {
        class: 'modal',
        onClick: function (e) {
          e.stopPropagation();
        },
      },
      [head, h('div', { class: 'modal-body' }, body)],
    );

    return h('div', { class: 'modal-overlay', onClick: closeModal }, [panel]);
  }

  function closeModal() {
    state.openCardId = null;
    render();
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
      } catch (err) {
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

  function onColumnDrop(e) {
    if (!drag.active) {
      return;
    }
    e.preventDefault();
    var ph = drag.placeholder;
    if (!ph || !ph.parentElement) {
      onDragEnd();
      return;
    }
    var list = ph.parentElement;
    var colId = list.dataset.colId;
    // The DOM only shows cards passing the active search/agent filter, so a
    // DOM position is not a valid index into the column's full card list.
    // Translate: find the first visible card after the placeholder and anchor
    // on its position among ALL of the column's cards (minus the dragged one).
    var nextCardId = null;
    var seenPh = false;
    var kids = list.children;
    for (var i = 0; i < kids.length; i++) {
      var child = kids[i];
      if (child === ph) {
        seenPh = true;
        continue;
      }
      if (seenPh && child.classList.contains('card') && child !== drag.el) {
        nextCardId = child.dataset.cardId;
        break;
      }
    }
    var index = 0;
    var b = board();
    var targetCol = null;
    if (b) {
      for (var c = 0; c < b.columns.length; c++) {
        if (b.columns[c].id === colId) {
          targetCol = b.columns[c];
          break;
        }
      }
    }
    if (targetCol) {
      var remaining = targetCol.cardIds.filter(function (id) {
        return id !== drag.cardId;
      });
      var anchor = nextCardId ? remaining.indexOf(nextCardId) : -1;
      index = anchor >= 0 ? anchor : remaining.length;
    }
    var cardId = drag.cardId;
    cleanupDrag();
    vscode.postMessage({ type: 'moveCard', cardId: cardId, toColumn: colId, index: index });
    // The resulting {type:'data'} message re-renders.
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
    if (drag.placeholder && drag.placeholder.parentElement) {
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
  function render() {
    if (drag.active) {
      return; // never re-render mid-drag
    }
    var app = document.getElementById('app');
    if (!app) {
      return;
    }

    // Preserve search focus + caret across the rebuild.
    var active = document.activeElement;
    var restoreSearch = active && active.id === 'search-input';
    var caretStart = restoreSearch ? active.selectionStart : 0;
    var caretEnd = restoreSearch ? active.selectionEnd : 0;

    while (app.firstChild) {
      app.removeChild(app.firstChild);
    }

    if (!state.data) {
      return;
    }

    // Drop a stale open card.
    if (state.openCardId && !board().cards[state.openCardId]) {
      state.openCardId = null;
    }

    app.appendChild(buildTopBar());
    app.appendChild(buildCanvas());
    app.appendChild(buildStatusBar());

    if (state.openCardId) {
      var modal = buildModal();
      if (modal) {
        app.appendChild(modal);
      }
    }

    if (restoreSearch) {
      var input = document.getElementById('search-input');
      if (input) {
        input.focus();
        try {
          input.setSelectionRange(caretStart, caretEnd);
        } catch (err) {
          /* ignore */
        }
      }
    } else if (state.addingCol) {
      var ta = document.getElementById('composer-' + state.addingCol);
      if (ta) {
        ta.focus();
        var len = ta.value.length;
        try {
          ta.setSelectionRange(len, len);
        } catch (err2) {
          /* ignore */
        }
      }
    }
  }

  function applyData(payload) {
    state.data = payload;
    // Drop filter for an agent that no longer exists.
    if (state.filterAgent && !agentDef(state.filterAgent)) {
      state.filterAgent = null;
    }
    render();
  }

  /* ---- Messaging ---- */
  window.addEventListener('message', function (event) {
    var msg = event.data;
    if (!msg || msg.type !== 'data') {
      return;
    }
    if (drag.active) {
      drag.pendingData = msg; // apply after the drag finishes
      return;
    }
    applyData(msg);
  });

  vscode.postMessage({ type: 'ready' });
})();
