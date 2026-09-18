/**
 * The webview's DOM helper, lifted verbatim from `media/board.js`.
 *
 * Every component here builds nodes with `h()` exactly as the shipped webview
 * does, so a story exercises the same markup the extension produces rather than
 * a Storybook-shaped imitation of it.
 *
 * MIRROR: `media/board.js` still carries its own copy — the shipped webview has
 * no build step and cannot import a module. This is not byte-identical to it:
 * that copy is held to ES5 and writes `Object.prototype.hasOwnProperty.call`,
 * while this one uses `Object.hasOwn`. What must match is the DOM the two
 * produce, so `mirror.test.ts` renders the same props through both copies and
 * compares the result rather than the source.
 */

/** @type {Record<string, string>} */
const EVT = {
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
 * @param {Node} node
 * @param {unknown} children
 * @returns {void}
 */
export function appendChildren(node, children) {
  if (Array.isArray(children)) {
    for (let i = 0; i < children.length; i++) {
      appendChildren(node, children[i]);
    }
  } else if (children instanceof Node) {
    node.appendChild(children);
  } else if (children != null && children !== false) {
    node.appendChild(document.createTextNode(String(children)));
  }
}

/**
 * @param {string} tag
 * @param {Record<string, any> | null} [props]
 * @param {unknown} [children]
 * @returns {HTMLElement}
 */
export function h(tag, props, children) {
  const node = document.createElement(tag);
  if (props) {
    for (const key in props) {
      if (!Object.hasOwn(props, key)) {
        continue;
      }
      const val = props[key];
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
        for (const dk in val) {
          if (Object.hasOwn(val, dk)) {
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
