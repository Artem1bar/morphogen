// registry.js — a tiny ordered registry mapping system id → factory + meta.
//
// Systems are registered in src/main.js. The registry preserves insertion
// order so the gallery and switcher present systems in a curated sequence.

export class Registry {
  constructor() {
    this._order = [];
    this._factories = new Map();
    this._meta = new Map();
  }

  /**
   * Register a system factory.
   * @param {() => object} factory returns a System instance
   * @param {object} [metaOverride] optional meta if the factory is expensive to
   *        call just to read meta; otherwise meta is read by instantiating once.
   */
  register(factory, metaOverride) {
    let meta = metaOverride;
    if (!meta) {
      const probe = factory();
      meta = probe.meta;
      if (probe.dispose) {
        try {
          probe.dispose();
        } catch {
          /* ignore probe dispose errors */
        }
      }
    }
    if (!meta || !meta.id) {
      throw new Error('System is missing meta.id');
    }
    if (this._factories.has(meta.id)) {
      throw new Error(`Duplicate system id: ${meta.id}`);
    }
    this._order.push(meta.id);
    this._factories.set(meta.id, factory);
    this._meta.set(meta.id, meta);
    return this;
  }

  has(id) {
    return this._factories.has(id);
  }

  get(id) {
    return this._factories.get(id);
  }

  meta(id) {
    return this._meta.get(id);
  }

  firstId() {
    return this._order[0];
  }

  /** Ordered list of { id, name, blurb, category }. */
  list() {
    return this._order.map((id) => this._meta.get(id));
  }

  get size() {
    return this._order.length;
  }
}
