// 记账偏好缓存合并策略（U7 互踩修复的统一出口）
// 本地缓存是“最近使用”的唯一事实来源：每次记完账立即同步写本地；
// 服务端偏好仅作兜底 —— 覆盖/空接口返回、冷启动无缓存时填充，永远不反向覆盖本地已有偏好。
// 首页预载、addBill 后台刷新、偏好写回都必须走这个合并，避免互踩。
const PREFERENCE_KEYS = ["expenseCategory", "incomeCategory", "account"];

const mergePreferences = (local, server) => {
  const result = {};
  for (const key of PREFERENCE_KEYS) {
    const localValue = local && local[key] !== undefined && local[key] !== null ? local[key] : null;
    const serverValue = server && server[key] !== undefined && server[key] !== null ? server[key] : null;
    result[key] = localValue !== null ? localValue : serverValue;
  }
  return result;
};

module.exports = { mergePreferences, PREFERENCE_KEYS };
