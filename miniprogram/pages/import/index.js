const app = getApp();
const brand = require("../../utils/brand");

Page({
  data: { fileName: "", fileID: "", previewData: [], memberMappings: [], importing: false, previewing: false, familyId: "", total: 0, lastBatchId: "", hasBrandAssets: brand.available,
    invalidList: [],
    downloadingTemplate: false,
    emptyImageFailed: false, doneImageFailed: false },
  async onLoad() { await app.ensureInitialized(); this.setData({ familyId: app.globalData.currentFamilyId }); },

  async downloadTemplate() {
    if (this.data.downloadingTemplate) return;
    this.setData({ downloadingTemplate: true });
    try {
      const res = await this.call("getImportTemplate", {});
      const dl = await wx.cloud.downloadFile({ fileID: res.fileID });
      const saveRes = await wx.saveFile({ tempFilePath: dl.tempFilePath });
      await wx.openDocument({ filePath: saveRes.savedFilePath, fileType: "xlsx", showMenu: true });
    } catch (error) {
      wx.showToast({ title: error.message || "下载失败", icon: "none" });
    } finally {
      this.setData({ downloadingTemplate: false });
    }
  },
  chooseFile() {
    wx.chooseMessageFile({ count: 1, type: "file", extension: ["xlsx"], success: async (selected) => {
      const file = selected.tempFiles[0];
      if (!file || !/\.xlsx$/i.test(file.name)) { wx.showToast({ title: "请选择 xlsx 文件", icon: "none" }); return; }
      this.setData({ previewing: true, previewData: [], fileName: file.name });
      try {
        const uploaded = await wx.cloud.uploadFile({ cloudPath: "imports/" + Date.now() + "-" + file.name, filePath: file.path });
        const result = await this.call("previewImport", { familyId: this.data.familyId, fileID: uploaded.fileID });
        this.setData({ fileID: uploaded.fileID, previewData: result.rows || [], memberMappings: result.memberMappings || [], total: result.total || 0, validCount: result.valid || 0, invalidList: result.invalid || [] });
      } catch (error) { wx.showToast({ title: error.message || "文件解析失败", icon: "none" }); this.setData({ fileName: "", fileID: "", memberMappings: [], invalidList: [], validCount: 0 }); }
      finally { this.setData({ previewing: false }); }
    } });
  },
  async confirmImport() {
    if (!this.data.fileID || this.data.importing) return;
    this.setData({ importing: true });
    try {
      const result = await this.call("confirmImport", { familyId: this.data.familyId, fileID: this.data.fileID });
const expImp = result.importedExpense || 0;
      const incImp = result.importedIncome || 0;
      const invalidCount = (result.invalid || []).length;
      const lines = [];
      if (expImp + incImp > 0) {
        lines.push("✅ 成功导入 " + result.imported + " 条");
        const sub = [];
        if (expImp) sub.push("支出 " + expImp + " 条");
        if (incImp) sub.push("收入 " + incImp + " 条");
        if (sub.length) lines.push("  " + sub.join("，"));
      }
      if (invalidCount > 0) lines.push("⚠️ 跳过 " + invalidCount + " 条无效（见下方汇总）");
      wx.showModal({ title: "导入完成", content: lines.join("\n") || "本次没有导入任何账单", showCancel: false });
      // 保留 total / validCount / invalidList —— 导入成功后用户仍要看到本次解析汇总（尤其是无效行明细）
      this.setData({ fileName: "", fileID: "", previewData: [], memberMappings: [], lastBatchId: result.batchId, invalidList: result.invalid || [] });
    } catch (error) {
      if (error.batchId) {
        this.setData({ lastBatchId: error.batchId, fileName: "", fileID: "" });
        wx.showModal({ title: "导入未完全完成", content: "已导入 " + (error.imported || 0) + " 条后中断，可撤销本次已导入的账单。", showCancel: false });
      } else {
        wx.showToast({ title: error.message || "导入失败", icon: "none" });
      }
    }
    finally { this.setData({ importing: false }); }
  },
  async rollbackLastImport() {
    if (!this.data.lastBatchId) return;
    const confirmed = await new Promise((resolve) => wx.showModal({ title: "撤销本次导入", content: "只会删除本次导入的账单，确定继续吗？", success: resolve }));
    if (!confirmed.confirm) return;
    try { const result = await this.call("rollbackImport", { familyId: this.data.familyId, batchId: this.data.lastBatchId }); wx.showToast({ title: "已撤销 " + result.removed + " 条" }); this.setData({ lastBatchId: "" }); } catch (error) { wx.showToast({ title: error.message || "撤销失败", icon: "none" }); }
  },
  async call(action, data) { const response = await wx.cloud.callFunction({ name: "accountingFunctions", data: { ...data, action } }); if (!response.result?.success) { const err = new Error(response.result?.message || "操作失败"); err.batchId = response.result?.batchId || ""; err.imported = response.result?.imported; throw err; } return response.result; },
  onEmptyImageError() { this.setData({ emptyImageFailed: true }); },
  onDoneImageError() { this.setData({ doneImageFailed: true }); }
});
