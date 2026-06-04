// gallery.js — the system switcher. Renders a grid of cards (one per system),
// grouped by category, and reports selection. Opens as an overlay panel.

export class Gallery {
  /**
   * @param {HTMLElement} root overlay container
   * @param {Array<{id,name,blurb,category}>} systems
   * @param {(id:string) => void} onSelect
   */
  constructor(root, systems, onSelect) {
    this.root = root;
    this.systems = systems;
    this.onSelect = onSelect;
    this.activeId = null;
    this._cards = new Map();
    this._build();
  }

  _build() {
    this.root.textContent = '';
    const panel = document.createElement('div');
    panel.className = 'gallery-panel';

    const header = document.createElement('div');
    header.className = 'gallery-header';
    header.innerHTML =
      '<h2>Systems</h2><button class="gallery-close" aria-label="Close">✕</button>';
    header.querySelector('.gallery-close').addEventListener('click', () =>
      this.close(),
    );
    panel.appendChild(header);

    // Group by category, preserving first-seen order.
    const groups = new Map();
    for (const s of this.systems) {
      const cat = s.category || 'Other';
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push(s);
    }

    for (const [cat, items] of groups) {
      const section = document.createElement('section');
      section.className = 'gallery-group';
      const h = document.createElement('h3');
      h.textContent = cat;
      section.appendChild(h);
      const grid = document.createElement('div');
      grid.className = 'gallery-grid';
      for (const s of items) {
        grid.appendChild(this._card(s));
      }
      section.appendChild(grid);
      panel.appendChild(section);
    }

    this.root.appendChild(panel);

    // Click on the backdrop (outside the panel) closes the gallery.
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });
  }

  _card(s) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'gallery-card';
    card.dataset.id = s.id;
    card.innerHTML = `
      <span class="gallery-card-name">${escapeHtml(s.name)}</span>
      <span class="gallery-card-blurb">${escapeHtml(s.blurb || '')}</span>
    `;
    card.addEventListener('click', () => {
      this.onSelect(s.id);
      this.close();
    });
    this._cards.set(s.id, card);
    return card;
  }

  setActive(id) {
    this.activeId = id;
    for (const [cid, card] of this._cards) {
      card.classList.toggle('active', cid === id);
    }
  }

  get isOpen() {
    return this.root.classList.contains('open');
  }

  open() {
    this.root.classList.add('open');
  }

  close() {
    this.root.classList.remove('open');
  }

  toggle() {
    this.root.classList.toggle('open');
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
