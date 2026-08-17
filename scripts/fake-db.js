// 内存版微信云数据库桩，仅覆盖测试所需的读写接口
function makeCommand() {
  const makeCond = (op, v) => {
    const cond = { __op: op, v };
    cond.and = (...args) => ({ __op: "and", v: [cond, ...args] });
    return cond;
  };
  const gte = (v) => makeCond("gte", v);
  const lte = (v) => makeCond("lte", v);
  const gt = (v) => makeCond("gt", v);
  const lt = (v) => makeCond("lt", v);
  const inOp = (v) => makeCond("in", v);
  const andOp = (...args) => ({ __op: "and", v: args });
  return { gte, lte, gt, lt, in: inOp, and: andOp };
}

function matchValue(docValue, cond) {
  if (cond && typeof cond === "object" && cond.__op) {
    switch (cond.__op) {
      case "gte": return docValue >= cond.v;
      case "lte": return docValue <= cond.v;
      case "gt": return docValue > cond.v;
      case "lt": return docValue < cond.v;
      case "in": return cond.v.includes(docValue);
      case "and": return cond.v.every((c) => matchValue(docValue, c));
      default: return false;
    }
  }
  return docValue === cond;
}

class FakeDB {
  constructor() {
    this.command = makeCommand();
    this.collections = {};
    this._seq = 0;
  }
  createCollection(name) {
    if (!this.collections[name]) this.collections[name] = [];
    return Promise.resolve();
  }
  _rows(name) {
    if (!this.collections[name]) this.collections[name] = [];
    return this.collections[name];
  }
  runTransaction(fn) {
    // 非隔离：直接读写同一份数据，足以验证“拒绝/成功”分支
    return Promise.resolve().then(() => fn(this));
  }
  collection(name) {
    const self = this;
    const chain = {
      _query: {}, _limit: null, _skip: 0, _order: null,
      where(q) { this._query = q || {}; return this; },
      limit(n) { this._limit = n; return this; },
      skip(n) { this._skip = n; return this; },
      orderBy(f, dir) { this._order = [f, dir]; return this; },
      async get() {
        let rows = self._rows(name).filter((doc) => Object.entries(this._query).every(([k, v]) => matchValue(doc[k], v)));
        if (this._order) {
          const [f, dir] = this._order;
          rows = rows.slice().sort((a, b) => {
            if (a[f] < b[f]) return dir === "desc" ? 1 : -1;
            if (a[f] > b[f]) return dir === "desc" ? -1 : 1;
            return 0;
          });
        }
        rows = rows.slice(this._skip);
        if (this._limit != null) rows = rows.slice(0, this._limit);
        return { data: rows };
      },
      async count() {
        const rows = self._rows(name).filter((doc) => Object.entries(this._query).every(([k, v]) => matchValue(doc[k], v)));
        return { total: rows.length };
      },
      async add({ data }) {
        const id = data._id || "id" + (self._seq++);
        self._rows(name).push({ _id: id, ...data });
        return { _id: id };
      },
      async update({ data }) {
        // where().update() 批量更新
        let n = 0;
        for (const doc of self._rows(name)) {
          if (Object.entries(this._query).every(([k, v]) => matchValue(doc[k], v))) {
            Object.assign(doc, data);
            n += 1;
          }
        }
        return { stats: { updated: n } };
      },
      doc(id) { return self._doc(name, id); }
    };
    return chain;
  }
  _doc(name, id) {
    const self = this;
    return {
      async get() {
        const doc = self._rows(name).find((d) => d._id === id);
        if (!doc) { const err = new Error("document.get:fail document not exists"); err.code = -1; throw err; }
        return { data: doc };
      },
      async set({ data }) {
        const existing = self._rows(name).find((d) => d._id === id);
        const doc = { _id: id, ...data };
        if (existing) Object.assign(existing, doc);
        else self._rows(name).push(doc);
        return { _id: id };
      },
      async update({ data }) {
        const doc = self._rows(name).find((d) => d._id === id);
        if (!doc) { const err = new Error("document.update:fail document not exists"); err.code = -1; throw err; }
        Object.assign(doc, data);
        return { stats: { updated: 1 } };
      },
      async remove() {
        const idx = self._rows(name).findIndex((d) => d._id === id);
        if (idx >= 0) self._rows(name).splice(idx, 1);
        return {};
      }
    };
  }
}

function makeCloud(openidProvider) {
  const db = new FakeDB();
  return {
    DYNAMIC_CURRENT_ENV: "test",
    command: db.command,
    init() {},
    database() { return db; },
    getWXContext() { return { OPENID: openidProvider() }; },
    getTempFileURL() {},
    downloadFile() {}
  };
}

module.exports = { FakeDB, makeCloud, matchValue };
