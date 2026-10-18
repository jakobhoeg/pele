import { searchDocumentation, type SearchItem } from '../lib/search';

const copyIcon = '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>';
const checkIcon = '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>';

const copyTimers = new WeakMap<HTMLButtonElement, number>();

function codeText(button: HTMLButtonElement) {
  if (button.dataset.copyText !== undefined) return button.dataset.copyText;
  const block = button.closest('[data-code-block]');
  if (!block) return '';
  const sourceLines = block.querySelectorAll<HTMLElement>('.doc-code-source');
  if (sourceLines.length) return [...sourceLines].map((line) => line.textContent ?? '').join('\n');
  return block.querySelector('code')?.textContent ?? '';
}

document.addEventListener('click', async (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>('[data-copy-code]');
  if (!button) return;
  const label = button.dataset.copyLabel ?? 'Copy code';
  try {
    await navigator.clipboard.writeText(codeText(button));
    button.dataset.copied = '';
    button.title = 'Copied';
    button.setAttribute('aria-label', 'Copied');
    button.innerHTML = checkIcon;
    const previous = copyTimers.get(button);
    if (previous) window.clearTimeout(previous);
    copyTimers.set(button, window.setTimeout(() => {
      delete button.dataset.copied;
      button.title = label;
      button.setAttribute('aria-label', label);
      button.innerHTML = copyIcon;
    }, 2000));
  } catch {
    delete button.dataset.copied;
  }
});

document.addEventListener('click', async (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>('[data-copy-markdown]');
  const markdownPath = button?.dataset.copyMarkdown;
  if (!button || !markdownPath) return;

  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  try {
    const markdown = fetch(markdownPath, { headers: { Accept: 'text/markdown' } }).then(async (response) => {
      if (!response.ok) throw new Error(`Unable to fetch ${markdownPath}`);
      return response.text();
    });
    if ('ClipboardItem' in window && navigator.clipboard.write) {
      const item = new ClipboardItem({ 'text/plain': markdown.then((value) => new Blob([value], { type: 'text/plain' })) });
      await navigator.clipboard.write([item]);
    } else {
      await navigator.clipboard.writeText(await markdown);
    }
    button.dataset.copied = '';
    button.innerHTML = `${checkIcon}<span>Copy Markdown</span>`;
    const previous = copyTimers.get(button);
    if (previous) window.clearTimeout(previous);
    copyTimers.set(button, window.setTimeout(() => {
      delete button.dataset.copied;
      button.innerHTML = `${copyIcon}<span>Copy Markdown</span>`;
    }, 2000));
  } catch {
    button.dataset.copyError = '';
    button.innerHTML = `${copyIcon}<span>Copy failed</span>`;
    const previous = copyTimers.get(button);
    if (previous) window.clearTimeout(previous);
    copyTimers.set(button, window.setTimeout(() => {
      delete button.dataset.copyError;
      button.innerHTML = `${copyIcon}<span>Copy Markdown</span>`;
    }, 2000));
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
});


const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character] ?? character));

function setupSearch() {
  const trigger = document.querySelector<HTMLButtonElement>('[data-search-trigger]');
  const backdrop = document.querySelector<HTMLElement>('[data-search-backdrop]');
  const input = document.querySelector<HTMLInputElement>('[data-search-input]');
  const clearButton = document.querySelector<HTMLButtonElement>('[data-search-clear]');
  const resultsElement = document.querySelector<HTMLElement>('[data-search-results]');
  const data = document.querySelector<HTMLScriptElement>('#search-index')?.textContent;
  if (!trigger || !backdrop || !input || !clearButton || !resultsElement || !data) return;

  const items = JSON.parse(data) as SearchItem[];
  const mobileSearch = window.matchMedia('(max-width: 760px)');
  let results: SearchItem[] = [];
  let activeIndex = 0;

  const syncClearButton = () => {
    clearButton.hidden = !mobileSearch.matches && input.value.length === 0;
    clearButton.setAttribute('aria-label', mobileSearch.matches ? 'Close search' : 'Clear search');
  };

  const render = () => {
    input.removeAttribute('aria-activedescendant');
    if (!results.length) {
      resultsElement.innerHTML = `<p class="command-empty" role="status">No documentation matches “${escapeHtml(input.value)}”.</p>`;
      return;
    }
    resultsElement.innerHTML = results.map((item, index) => {
      const title = escapeHtml(item.title);
      const titleElement = item.kind === 'field'
        ? `<code>${title}</code>`
        : `<span class="command-result-title">${title}</span>`;

      return `
        <a id="search-result-${index}" class="${index === activeIndex ? 'is-active' : ''}" href="${escapeHtml(item.href)}" role="option" aria-selected="${index === activeIndex}" tabindex="-1" data-result-index="${index}">
          ${titleElement}
          <p>${escapeHtml(item.summary)}</p>
          <span class="command-result-open" aria-hidden="true">↵</span>
        </a>
      `;
    }).join('');
    input.setAttribute('aria-activedescendant', `search-result-${activeIndex}`);
  };

  const setActiveIndex = (index: number, scroll = false) => {
    if (!results.length) return;
    activeIndex = Math.max(0, Math.min(index, results.length - 1));
    input.setAttribute('aria-activedescendant', `search-result-${activeIndex}`);
    resultsElement.querySelectorAll<HTMLElement>('[data-result-index]').forEach((result) => {
      const active = Number(result.dataset.resultIndex) === activeIndex;
      result.classList.toggle('is-active', active);
      result.setAttribute('aria-selected', String(active));
      if (active && scroll) result.scrollIntoView({ block: 'nearest' });
    });
  };

  const update = () => {
    results = searchDocumentation(items, input.value);
    activeIndex = 0;
    render();
    resultsElement.scrollTop = 0;
  };

  const open = () => {
    document.dispatchEvent(new CustomEvent('pele:overlay-open', { detail: 'search' }));
    input.readOnly = false;
    input.value = '';
    update();
    backdrop.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    syncClearButton();
    document.documentElement.classList.add('search-open');
    input.focus({ preventScroll: true });
  };
  const close = (restoreFocus = true) => {
    if (backdrop.hidden) return;
    input.readOnly = true;
    input.blur();
    backdrop.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    syncClearButton();
    document.documentElement.classList.remove('search-open');
    if (restoreFocus) trigger.focus({ preventScroll: true });
  };
  const navigate = (href: string) => {
    close(false);
    requestAnimationFrame(() => window.location.assign(href));
  };

  trigger.addEventListener('click', open);
  backdrop.addEventListener('mousedown', (event) => { if (event.target === backdrop) close(); });
  input.addEventListener('input', () => {
    syncClearButton();
    update();
  });
  clearButton.addEventListener('click', () => {
    if (mobileSearch.matches) {
      close();
      return;
    }
    input.value = '';
    syncClearButton();
    update();
    input.focus();
  });
  mobileSearch.addEventListener('change', syncClearButton);
  resultsElement.addEventListener('mousemove', (event) => {
    const result = (event.target as Element).closest<HTMLElement>('[data-result-index]');
    if (!result) return;
    setActiveIndex(Number(result.dataset.resultIndex));
  });
  resultsElement.addEventListener('click', (event) => {
    const result = (event.target as Element).closest<HTMLAnchorElement>('a[data-result-index]');
    if (!result || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(result.href);
  });
  input.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex(activeIndex + 1, true); }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex(activeIndex - 1, true); }
    if (event.key === 'Enter' && results[activeIndex]) {
      event.preventDefault();
      navigate(results[activeIndex].href);
    }
  });
  // Capture the shortcut before an editor's own bindings can act on it.
  window.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      event.stopPropagation();
      open();
      return;
    }
    if (backdrop.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'Tab') {
      event.preventDefault();
      if (!clearButton.hidden && document.activeElement === input) clearButton.focus();
      else input.focus();
    }
  }, true);
  document.addEventListener('pele:overlay-open', (event) => {
    if ((event as CustomEvent<string>).detail !== 'search') close(false);
  });
  window.addEventListener('pagehide', () => close(false));
}

function setupMobileDocsMenu() {
  const trigger = document.querySelector<HTMLButtonElement>('[data-docs-menu-trigger]');
  const backdrop = document.querySelector<HTMLElement>('[data-docs-menu-backdrop]');
  const header = trigger?.closest<HTMLElement>('[data-scroll-header]');
  if (!trigger || !backdrop || !header) return;

  const mobile = window.matchMedia('(max-width: 760px)');
  const updateMenuTop = () => {
    backdrop.style.top = `${header.getBoundingClientRect().bottom}px`;
  };
  new ResizeObserver(updateMenuTop).observe(header);
  window.addEventListener('resize', updateMenuTop);
  const close = () => {
    if (backdrop.hidden) return;
    if (backdrop.contains(document.activeElement)) trigger.focus({ preventScroll: true });
    backdrop.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', 'Open documentation menu');
    document.documentElement.classList.remove('docs-menu-open');
  };
  const open = () => {
    if (!mobile.matches) return;
    document.dispatchEvent(new CustomEvent('pele:overlay-open', { detail: 'docs-menu' }));
    backdrop.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    trigger.setAttribute('aria-label', 'Close documentation menu');
    document.documentElement.classList.add('docs-menu-open');
    updateMenuTop();
  };

  trigger.addEventListener('click', () => backdrop.hidden ? open() : close());
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close();
  });
  header.addEventListener('click', (event) => {
    if ((event.target as Element).closest('a')) close();
  });
  window.addEventListener('pagehide', close);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });
  mobile.addEventListener('change', (event) => {
    if (!event.matches) close();
  });
  document.addEventListener('pele:overlay-open', (event) => {
    if ((event as CustomEvent<string>).detail !== 'docs-menu') close();
  });
}

function setupMobileHeader() {
  const header = document.querySelector<HTMLElement>('[data-scroll-header]');
  const slot = header?.closest<HTMLElement>('[data-scroll-header-slot]');
  if (!header || !slot) return;

  const mobile = window.matchMedia('(max-width: 760px)');
  const transitionDuration = 240;
  let previousScrollY = window.scrollY;
  let frame = 0;
  let revealFrame = 0;
  let dismissTimer = 0;
  let keepVisibleForHeading = false;

  new ResizeObserver(() => {
    document.documentElement.style.setProperty('--mobile-header-height', `${header.getBoundingClientRect().height}px`);
  }).observe(header);

  const reset = () => {
    if (revealFrame) window.cancelAnimationFrame(revealFrame);
    if (dismissTimer) window.clearTimeout(dismissTimer);
    revealFrame = 0;
    dismissTimer = 0;
    header.classList.remove('is-header-floating', 'is-header-visible');
    slot.style.removeProperty('height');
  };
  const reveal = () => {
    if (!mobile.matches) return;
    if (dismissTimer) window.clearTimeout(dismissTimer);
    dismissTimer = 0;
    if (!header.classList.contains('is-header-floating')) {
      slot.style.height = `${slot.offsetHeight}px`;
      header.classList.add('is-header-floating');
      void header.offsetHeight;
    }
    if (revealFrame) window.cancelAnimationFrame(revealFrame);
    revealFrame = window.requestAnimationFrame(() => {
      revealFrame = 0;
      header.classList.add('is-header-visible');
    });
  };
  const dismiss = () => {
    if (!header.classList.contains('is-header-floating')) return;
    if (!header.classList.contains('is-header-visible') && dismissTimer) return;
    if (revealFrame) window.cancelAnimationFrame(revealFrame);
    revealFrame = 0;
    header.classList.remove('is-header-visible');
    if (dismissTimer) window.clearTimeout(dismissTimer);
    dismissTimer = window.setTimeout(reset, transitionDuration);
  };
  const update = () => {
    frame = 0;
    const currentScrollY = window.scrollY;
    const revealThreshold = slot.offsetTop + slot.offsetHeight + 24;
    const reachedOriginalPosition = currentScrollY <= slot.offsetTop;
    if (!mobile.matches || reachedOriginalPosition) {
      reset();
    } else if (keepVisibleForHeading) {
      reveal();
    } else if (currentScrollY > previousScrollY + 2) {
      dismiss();
    } else if (
      currentScrollY < previousScrollY - 2
      && (header.classList.contains('is-header-floating') || currentScrollY > revealThreshold)
    ) {
      reveal();
    }
    previousScrollY = currentScrollY;
  };
  const scheduleUpdate = () => {
    if (!frame) frame = window.requestAnimationFrame(update);
  };

  window.addEventListener('scroll', scheduleUpdate, { passive: true });
  header.addEventListener('click', (event) => {
    const link = (event.target as Element).closest<HTMLAnchorElement>('[data-docs-menu-backdrop] a[href^="#"]');
    if (!mobile.matches || !link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    if (!document.getElementById(decodeURIComponent(link.hash.slice(1)))) return;
    keepVisibleForHeading = true;
    reveal();
  });
  const resumeScrollBehavior = () => { keepVisibleForHeading = false; };
  window.addEventListener('wheel', resumeScrollBehavior, { passive: true });
  window.addEventListener('touchmove', resumeScrollBehavior, { passive: true });
  window.addEventListener('keydown', (event) => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) resumeScrollBehavior();
  });
  window.addEventListener('pageshow', () => {
    keepVisibleForHeading = false;
    previousScrollY = window.scrollY;
    reset();
  });
  mobile.addEventListener('change', () => {
    keepVisibleForHeading = false;
    previousScrollY = window.scrollY;
    reset();
  });
  document.addEventListener('pele:overlay-open', () => {
    if (window.scrollY > slot.offsetTop + slot.offsetHeight + 24) reveal();
  });
}

// The theme is first set in the page's head. A visitor's choice is kept; until there is one,
// the page follows their system's setting as it changes.
function setupTheme() {
  const storageKey = 'pele:theme';
  const system = window.matchMedia('(prefers-color-scheme: light)');
  const toggles = [...document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]')];
  const apply = (theme: 'light' | 'dark') => {
    document.documentElement.dataset.theme = theme;
    const label = theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
    toggles.forEach((toggle) => {
      toggle.title = label;
      toggle.setAttribute('aria-label', label);
    });
    document.dispatchEvent(new CustomEvent('pele:theme-change', { detail: theme }));
  };
  const saved = () => {
    try {
      return localStorage.getItem(storageKey);
    } catch {
      return null;
    }
  };
  apply(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  toggles.forEach((toggle) => toggle.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      // The choice still applies for this visit.
    }
    apply(next);
  }));
  system.addEventListener('change', () => {
    if (!saved()) apply(system.matches ? 'light' : 'dark');
  });
}

import { setupOutline } from './outline';

setupTheme();
setupOutline();
setupMobileHeader();
setupMobileDocsMenu();
setupSearch();
