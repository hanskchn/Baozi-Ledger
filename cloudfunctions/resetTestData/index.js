// 临时测试数据重置函数（验收用，验证后删除）
// 创建缺失集合 + 清空全部业务集合数据
const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const COLLECTIONS = [
  "users", "families", "family_members", "family_invites",
  "categories", "accounts", "bills", "budgets",
  "bill_preferences", "operation_logs", "initialization_locks"
];

exports.main = async () => {
  const results = {};
  for (const name of COLLECTIONS) {
    try {
      let note = "";
      try {
        await db.createCollection(name);
        note = "created";
      } catch (e) {
        note = "exists";
      }
      let removed = 0;
      for (;;) {
        const batch = await db.collection(name).limit(100).get();
        if (!batch.data.length) break;
        const ids = batch.data.map((d) => d._id);
        await db.collection(name).where({ _id: db.command.in(ids) }).remove();
        removed += ids.length;
      }
      results[name] = `${note}, cleared=${removed}`;
    } catch (e) {
      results[name] = "ERROR " + (e.message || e);
    }
  }
  return { ok: true, results };
};
