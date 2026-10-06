/**
 * The hub is a generated static page. The only thing it needs at runtime is
 * the theme, so this stays deliberately small - no framework, no router, and
 * no reason for the page to be blank if it fails.
 */
import { activeTheme, applyTheme, themeToggle } from './theme.js';

applyTheme(activeTheme());

function h(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(child));
  }
  return node;
}

const chrome = document.querySelector('.hub__chrome');
if (chrome) chrome.append(themeToggle(h));
