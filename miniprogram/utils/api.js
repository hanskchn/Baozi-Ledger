// 统一云函数调用层（Q2）
// 集中动作拼装、错误收敛与附加信息透传（batchId/imported 等）；
// 新增页面一律走本层，存量页面逐步迁移（计划 Phase C 口径）。
const callFunction = async (name, action, data = {}) => {
  const response = await wx.cloud.callFunction({ name, data: { ...data, action } });
  const result = response && response.result ? response.result : null;
  if (!result) throw new Error("服务器无响应，请稍后重试");
  if (result.success === false) {
    const err = new Error(result.message || "操作失败");
    err.errorCode = result.errorCode || "BAD_REQUEST";
    if (result.batchId) err.batchId = result.batchId;
    if (typeof result.imported === "number") err.imported = result.imported;
    throw err;
  }
  return result;
};

module.exports = { callFunction };
