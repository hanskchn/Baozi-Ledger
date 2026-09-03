// 内存版微信云数据库桩，仅覆盖测试所需的读写接口
function makeCommand() {
  // 构造一个始终可继续 .and() 的“与”条件对象，保证 gte().and().and() 链式可用。
  const makeAndCond = (conditions) => {
    const cond = { __op: "and", v: conditions };
    cond.and = (...args) => makeAndCond([...conditions, ...args]);
    return cond;
  };
  const makeCond = (op, v) => {
    const cond = { __op: op, v };
    cond.and = (...args) => makeAndCond([cond, ...args]);
    return cond;
  };
  const gte = (v) => makeCond("gte", v);
  const lte = (v) => makeCond("lte", v);
  const gt = (v) => makeCond("gt", v);
  const lt = (v) => makeCond("lt", v);
  const inOp = (v) => makeCond("in", v);
  const andOp = (...args) => makeAndCond(args);
  const inc = (v) => ({ __op: "inc", v });
  // 聚合表达式操作符：sum("$amount") / substr(["$date", 0, 10])
  const sum = (field) => ({ __op: "sum", field });
  const substr = (args) => ({ __op: "substr", args });
  const aggregate = { sum, substr };
  return { gte, lte, gt, lt, in: inOp, and: andOp, inc, aggregate };
}

// 应用更新数据，支持 { count: command.inc(1) } 这类自增操作
function applyUpdates(doc, data) {
  for (const key of Object.keys(data)) {
    const value = data[key];
    if (value && typeof value === "object" && value.__op === "inc") {
      doc[key] = (Number(doc[key]) || 0) + value.v;
    } else {
      doc[key] = value;
    }
  }
}

function matchValue(docValue, cond) {
  if (cond && typeof cond === "object" && cond.$regularExpression) {
    try {
      return new RegExp(cond.$regularExpression.pattern, cond.$regularExpression.options || "").test(String(docValue === undefined || docValue === null ? "" : docValue));
    } catch (error) {
      return false;
    }
  }
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

// 解析聚合表达式：字符串 "$field" 取字段；__op 标记的按聚合操作符处理；普通对象递归。
function resolveExpr(doc, expr) {
  if (expr == null) return expr;
  if (typeof expr === "string") {
    return expr.startsWith("$") ? doc[expr.slice(1)] : expr;
  }
  if (typeof expr === "object" && expr.__op) {
    // 聚合表达式：substr / sum 等
    if (expr.__op === "substr") {
      const args = expr.args;
      const str = String(resolveExpr(doc, args[0]) || "");
      const start = Number(args[1]) || 0;
      const length = args.length > 2 ? Number(args[2]) : undefined;
      return length == null ? str.substring(start) : str.substring(start, start + length);
    }
    if (expr.__op === "sum") {
      // sum 仅在 $group 累加器里用，group 阶段直接处理，不会走到这里
      return 0;
    }
    return expr;
  }
  if (Array.isArray(expr)) return expr.map((v) => resolveExpr(doc, v));
  if (typeof expr === "object") {
    const result = {};
    for (const [k, v] of Object.entries(expr)) result[k] = resolveExpr(doc, v);
    return result;
  }
  return expr;
}

// 在内存中跑聚合管道。仅支持 $match / $group，足够测试 getStats 用。
function runAggregatePipeline(rows, pipeline) {
  let data = rows;
  for (const stage of pipeline) {
    if (stage.$match) {
      data = data.filter((doc) => Object.entries(stage.$match).every(([k, v]) => matchValue(doc[k], v)));
    } else if (stage.$group) {
      const groups = new Map();
      for (const doc of data) {
        const keyObj = resolveExpr(doc, stage.$group._id);
        const key = JSON.stringify(keyObj);
        let bucket = groups.get(key);
        if (!bucket) { bucket = { _id: keyObj }; groups.set(key, bucket); }
        for (const [k, v] of Object.entries(stage.$group)) {
          if (k === "_id") continue;
          if (v && v.__op === "sum") {
            const field = v.field.replace(/^\$/, "");
            bucket[k] = (bucket[k] || 0) + Number(doc[field] || 0);
          }
        }
      }
      data = Array.from(groups.values());
    }
  }
  return data;
}

class FakeDB {
  constructor() {
    this.command = makeCommand();
    this.collections = {};
    this._seq = 0;
  }
  RegExp({ regexp, options }) {
    return { $regularExpression: { pattern: regexp || "", options: options || "" } };
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
      _matchesQuery(doc) {
        if (this._query.$or) {
          const orMatch = this._query.$or.some((clause) => Object.entries(clause).every(([k, v]) => matchValue(doc[k], v)));
          if (!orMatch) return false;
        }
        return Object.entries(this._query).filter(([k]) => k !== "$or").every(([k, v]) => matchValue(doc[k], v));
      },
      async get() {
        let rows = self._rows(name).filter((doc) => this._matchesQuery(doc));
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
        const rows = self._rows(name).filter((doc) => this._matchesQuery(doc));
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
            applyUpdates(doc, data);
            n += 1;
          }
        }
        return { stats: { updated: n } };
      },
      async remove() {
        // where().remove() 批量删除
        const targets = self._rows(name).filter((doc) => this._matchesQuery(doc));
        for (const doc of targets) {
          const idx = self._rows(name).indexOf(doc);
          if (idx >= 0) self._rows(name).splice(idx, 1);
        }
        return { removed: targets.length };
      },
      doc(id) { return self._doc(name, id); },
      // 聚合管道：match().group().end() 返回 { list }
      aggregate() {
        const pipeline = [];
        return {
          match(cond) { pipeline.push({ $match: cond }); return this; },
          group(spec) { pipeline.push({ $group: spec }); return this; },
          async end() {
            const rows = self._rows(name).slice();
            return { list: runAggregatePipeline(rows, pipeline) };
          }
        };
      }
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
        applyUpdates(doc, data);
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
