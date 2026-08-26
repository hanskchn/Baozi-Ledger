// 测试数据重置函数（仅开发者可调用）
// 不传 collections 时清空全部集合；传入时只清指定集合。
const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const DEVELOPER_OPENIDS = ["oEntM3edll4iSPXTT0RzgomZNFIM"];

const ALL_COLLECTIONS = [
  "users",
  "families",
  "family_members",
  "family_invites",
  "categories",
  "accounts",
  "bills",
  "budgets",
  "bill_preferences",
  "operation_logs",
  "initialization_locks",
  "feedbacks"
];

const CLEAR_PARALLEL = 5;
const CLEAR_BATCH = 100;

const getOpenid = () => cloud.getWXContext().OPENID;

const countCollection = async (name) => {
  try {
    const result = await db.collection(name).count();
    return result.total || 0;
  } catch (error) {
    return 0;
  }
};

const clearCollection = async (name) => {
  try {
    try {
      await db.createCollection(name);
    } catch (error) {
      // 集合已存在，忽略
    }
    let removed = 0;
    for (;;) {
      // 并行拉取 5 页（每页 100 条）的 _id，再一次性删除整批，减少串行往返
      const pages = await Promise.all(
        Array.from({ length: CLEAR_PARALLEL }, (_, index) =>
          db.collection(name).field({ _id: true }).skip(index * CLEAR_BATCH).limit(CLEAR_BATCH).get()
        )
      );
      const ids = [];
      for (const page of pages) {
        for (const item of page.data || []) {
          if (!ids.includes(item._id)) ids.push(item._id);
        }
      }
      if (!ids.length) break;
      await db.collection(name).where({ _id: db.command.in(ids) }).remove();
      removed += ids.length;
      if (ids.length < CLEAR_PARALLEL * CLEAR_BATCH) break;
    }
    return { success: true, name, removed };
  } catch (error) {
    return { success: false, name, error: error.message || String(error) };
  }
};

const getCounts = async (names) => {
  const counts = {};
  await Promise.all(names.map(async (name) => {
    counts[name] = await countCollection(name);
  }));
  return counts;
};

exports.main = async (event) => {
  const openid = getOpenid();
  if (!DEVELOPER_OPENIDS.includes(openid)) {
    throw new Error("无权限执行该操作");
  }

  if (event.action === "counts") {
    return { success: true, counts: await getCounts(ALL_COLLECTIONS) };
  }

  let targets = ALL_COLLECTIONS;
  if (event.action === "clear" && Array.isArray(event.collections) && event.collections.length) {
    const invalid = event.collections.filter((name) => !ALL_COLLECTIONS.includes(name));
    if (invalid.length) throw new Error("不支持清除的集合：" + invalid.join("、"));
    targets = event.collections;
  }

  const before = await getCounts(targets);
  const results = await Promise.all(targets.map((name) => clearCollection(name)));
  return { success: true, before, results };
};
