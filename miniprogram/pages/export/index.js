const app = getApp();

Page({
  data: {
    exporting: false,
    exportStage: "",        // "" | "generating" | "downloading" | "opening" | "done"
    exportProgress: 0,       // 0-100，仅 downloading 阶段有真实值
    exportStageText: "",
    familyId: "",
    // 时间（与 filter.wxml 同款：单选 + quick/month/range）
    filterMonth: "",
    filterDateStart: "",
    filterDateEnd: "",
    timeDisplay: "全部时间",
    timeMode: "all",
    quick: "all",
    tempMonth: "",
    tempDateStart: "",
    tempDateEnd: "",
    showTimeSheet: false,
    // 分类（多选；复用账单筛选页平铺样式，选中状态用二级唯一 id）
    allCategories: [],
    categoryGroups: [],
    allCategoryIds: [],
    selectedCategoryIds: [],
    categoryDisplay: "全选",
    showCategorySheet: false,
    // 账户（多选）
    accountList: [],
    selectedAccountIds: [],
    selectedAccountMap: {},
    accountDisplay: "全选",
    showAccountPanel: false,
    // 成员（多选）
    memberList: [],
    selectedMemberIds: [],
    selectedMemberMap: {},
    memberDisplay: "全选",
    showMemberPanel: false
  },

  stopPropagation() {},

  async onLoad() {
    await app.ensureInitialized();
    this.setData({ familyId: app.globalData.currentFamilyId });
    await this._loadOptions();
  },

  async _loadOptions() {
    if (!this.data.familyId) return;
    try {
      const res = await this.call("listFormOptions", { familyId: this.data.familyId });
      const categories = res.categories || [];
      const accounts = (res.accounts || []).filter((a) => a.enabled !== false);
      const members = res.members || [];

      const allIds = [];
      categories.forEach((c) => (c.children || []).forEach((child) => allIds.push(child.id)));

      this.setData({
        allCategories: categories,
        allCategoryIds: allIds,
        selectedCategoryIds: [...allIds],
        accountList: accounts,
        memberList: members,
        selectedAccountIds: accounts.map((a) => a._id),
        selectedMemberIds: members.map((m) => m.memberId)
      });
      this._syncAccountMap();
      this._syncMemberMap();
      this._refreshDisplays();
    } catch (error) {
      wx.showToast({ title: error.message || "加载选项失败", icon: "none" });
    }
  },

  async call(action, data) {
    const response = await wx.cloud.callFunction({ name: "accountingFunctions", data: { ...data, action } });
    if (!response.result?.success) throw new Error(response.result?.message || "操作失败");
    return response.result;
  },

  _refreshDisplays() {
    const fmt = (n, total, noneText) => {
      if (total === 0) return noneText;
      if (n === 0) return "未选";
      if (n === total) return "全选";
      return "已选 " + n + " / " + total;
    };
    this.setData({
      categoryDisplay: fmt(this.data.selectedCategoryIds.length, this.data.allCategoryIds.length, "暂无分类"),
      accountDisplay: fmt(this.data.selectedAccountIds.length, this.data.accountList.length, "暂无账户"),
      memberDisplay: fmt(this.data.selectedMemberIds.length, this.data.memberList.length, "暂无成员")
    });
  },

  onReset() {
    this.setData({
      filterMonth: "",
      filterDateStart: "",
      filterDateEnd: "",
      timeDisplay: "全部时间",
      timeMode: "all",
      quick: "all",
      tempMonth: "",
      tempDateStart: "",
      tempDateEnd: "",
      selectedCategoryIds: [...this.data.allCategoryIds],
      selectedAccountIds: this.data.accountList.map((a) => a._id),
      selectedMemberIds: this.data.memberList.map((m) => m.memberId),
      categoryDisplay: "全选",
      accountDisplay: "全选",
      memberDisplay: "全选"
    });
    this._syncAccountMap();
    this._syncMemberMap();
  },

  // ===== 时间弹层 =====
  openTimeSheet() {
    this.setData({
      showTimeSheet: true,
      tempMonth: this.data.filterMonth,
      tempDateStart: this.data.filterDateStart,
      tempDateEnd: this.data.filterDateEnd
    });
  },
  closeTimeSheet() { this.setData({ showTimeSheet: false }); },
  selectQuick(e) {
    const key = e.currentTarget.dataset.key;
    const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, "0");
    if (key === "thisMonth") this.setData({ quick: "thisMonth", timeMode: "all", filterMonth: y + "-" + m, filterDateStart: "", filterDateEnd: "" });
    else if (key === "lastMonth") {
      const prev = new Date(Date.UTC(y, now.getUTCMonth() - 1, 1));
      this.setData({ quick: "lastMonth", timeMode: "all", filterMonth: prev.getUTCFullYear() + "-" + String(prev.getUTCMonth() + 1).padStart(2, "0"), filterDateStart: "", filterDateEnd: "" });
    } else if (key === "thisYear") this.setData({ quick: "thisYear", timeMode: "all", filterMonth: y + "-01", filterDateEnd: y + "-12" });
    else if (key === "all") this.setData({ quick: "all", timeMode: "all", filterMonth: "", filterDateStart: "", filterDateEnd: "" });
    else if (key === "customMonth") this.setData({ timeMode: "month", tempMonth: this.data.filterMonth || y + "-" + m });
    else if (key === "customRange") this.setData({ timeMode: "range" });
  },
  onTempMonthChange(e) { this.setData({ tempMonth: e.detail.value, quick: "custom" }); },
  onTempStartChange(e) { this.setData({ tempDateStart: e.detail.value, quick: "custom" }); },
  onTempEndChange(e) { this.setData({ tempDateEnd: e.detail.value, quick: "custom" }); },
  confirmTimeSheet() {
    const { timeMode, tempMonth, tempDateStart, tempDateEnd, filterMonth } = this.data;
    let display = "全部时间";
    let next = { showTimeSheet: false };
    if (timeMode === "month" && tempMonth) {
      next.filterMonth = tempMonth;
      next.filterDateStart = "";
      next.filterDateEnd = "";
      const [y, m] = tempMonth.split("-");
      display = y + "年" + Number(m) + "月";
    } else if (timeMode === "range" && (tempDateStart || tempDateEnd)) {
      next.filterMonth = "";
      next.filterDateStart = tempDateStart;
      next.filterDateEnd = tempDateEnd;
      display = (tempDateStart || "*") + " ~ " + (tempDateEnd || "*");
    } else if (filterMonth) {
      const [y, m] = filterMonth.split("-");
      display = y + "年" + Number(m) + "月";
    } else if (this.data.filterDateStart || this.data.filterDateEnd) {
      display = (this.data.filterDateStart || "*") + " ~ " + (this.data.filterDateEnd || "*");
    }
    next.timeDisplay = display;
    this.setData(next);
  },

  // ===== 分类弹层（复用账单筛选页平铺样式，多选）=====
  _buildCategoryGroups(selectedIds) {
    const selected = selectedIds || this.data.selectedCategoryIds;
    const buildOne = (parent) => {
      const children = (parent.children || []).map((child) => ({
        id: child.id,
        name: child.name,
        icon: child.icon || "📝",
        active: selected.indexOf(child.id) >= 0
      }));
      if (!children.length) return null;
      const activeCount = children.filter((c) => c.active).length;
      return {
        id: parent.id || parent.name,
        name: parent.name,
        icon: parent.icon || "📂",
        type: parent.type,
        typeLabel: parent.type === "income" ? "收入" : "支出",
        active: activeCount === children.length,
        children
      };
    };
    // 按类型分组：先支出后收入，组内保持云函数返回的 createTime asc 顺序
    const expense = [];
    const income = [];
    (this.data.allCategories || []).forEach((parent) => {
      const g = buildOne(parent);
      if (!g) return;
      if (parent.type === "income") income.push(g);
      else expense.push(g);
    });
    return { expense, income };
  },
  openCategorySheet() {
    this.setData({
      showCategorySheet: true,
      categoryGroups: this._buildCategoryGroups(this.data.selectedCategoryIds)
    });
  },
  closeCategorySheet() { this.setData({ showCategorySheet: false }); },
  toggleParentCategory(e) {
    const id = e.currentTarget.dataset.id;
    const parent = this.data.allCategories.find((c) => (c.id || c.name) === id);
    if (!parent || !parent.children || !parent.children.length) return;
    const childIds = parent.children.map((c) => c.id);
    const list = this.data.selectedCategoryIds;
    const allSelected = childIds.every((cid) => list.indexOf(cid) >= 0);
    const next = allSelected
      ? list.filter((cid) => childIds.indexOf(cid) < 0)
      : Array.from(new Set(list.concat(childIds)));
    this.setData({ selectedCategoryIds: next, categoryGroups: this._buildCategoryGroups(next) });
  },
  toggleChildCategory(e) {
    const id = e.currentTarget.dataset.id;
    const list = this.data.selectedCategoryIds;
    const idx = list.indexOf(id);
    const next = idx >= 0 ? list.filter((x) => x !== id) : list.concat(id);
    this.setData({ selectedCategoryIds: next, categoryGroups: this._buildCategoryGroups(next) });
  },
  selectAllCategories() {
    const all = this.data.allCategoryIds;
    const isAll = all.length > 0 && this.data.selectedCategoryIds.length === all.length;
    const next = isAll ? [] : [...all];
    this.setData({ selectedCategoryIds: next, categoryGroups: this._buildCategoryGroups(next) });
  },
  confirmCategorySheet() {
    this.setData({ showCategorySheet: false });
    this._refreshDisplays();
  },
  _boolMap(list) {
    const map = {};
    (list || []).forEach((id) => { map[id] = true; });
    return map;
  },
  _syncAccountMap() {
    this.setData({ selectedAccountMap: this._boolMap(this.data.selectedAccountIds) });
  },
  _syncMemberMap() {
    this.setData({ selectedMemberMap: this._boolMap(this.data.selectedMemberIds) });
  },

  // ===== 账户（行内 chip 多选）=====
  toggleAccountPanel() {
    this.setData({ showAccountPanel: !this.data.showAccountPanel });
  },
  toggleAccount(e) {
    const id = e.currentTarget.dataset.id;
    const list = this.data.selectedAccountIds;
    const idx = list.indexOf(id);
    const next = idx >= 0 ? list.filter((x) => x !== id) : list.concat(id);
    this.setData({ selectedAccountIds: next, selectedAccountMap: this._boolMap(next) });
    this._refreshDisplays();
  },

  // ===== 成员（行内 chip 多选）=====
  toggleMemberPanel() {
    this.setData({ showMemberPanel: !this.data.showMemberPanel });
  },
  toggleMember(e) {
    const id = e.currentTarget.dataset.id;
    const list = this.data.selectedMemberIds;
    const idx = list.indexOf(id);
    const next = idx >= 0 ? list.filter((x) => x !== id) : list.concat(id);
    this.setData({ selectedMemberIds: next, selectedMemberMap: this._boolMap(next) });
    this._refreshDisplays();
  },

  // ===== 导出（分阶段进度：生成 → 下载 → 打开）=====
  _setStage(stage, text, progress) {
    const patch = { exportStage: stage, exportStageText: text };
    if (typeof progress === "number") patch.exportProgress = progress;
    this.setData(patch);
  },
  _downloadFileWithProgress(fileID) {
    return new Promise((resolve, reject) => {
      const task = wx.cloud.downloadFile({
        fileID,
        success: resolve,
        fail: reject
      });
      if (task && typeof task.onProgressUpdate === "function") {
        task.onProgressUpdate((res) => {
          const p = Math.max(0, Math.min(100, Number(res.progress) || 0));
          this.setData({ exportProgress: p });
        });
      }
    });
  },
  async onExport() {
    if (this.data.exporting) return;
    if (!this.data.familyId) { wx.showToast({ title: "请先确认加入账本", icon: "none" }); return; }
    this.setData({ exporting: true, exportStage: "generating", exportProgress: 0, exportStageText: "正在查询账单并生成文件..." });
    try {
      const totalCats = this.data.allCategoryIds.length;
      const selectedCats = this.data.selectedCategoryIds.length;
      const isAllCategoriesSelected = totalCats === 0 || selectedCats === totalCats;
      const payload = {
        familyId: this.data.familyId,
        dateStart: this.data.filterDateStart || "",
        dateEnd: this.data.filterDateEnd || "",
        month: this.data.filterMonth || "",
        accounts: this.data.accountList.filter((a) => this.data.selectedAccountIds.indexOf(a._id) >= 0).map((a) => a.name),
        memberIds: this.data.selectedMemberIds
      };
      if (!isAllCategoriesSelected) {
        if (selectedCats === 0) {
          payload.categories = [];
        } else {
          const categories = [];
          this.data.allCategories.forEach((parent) => {
            (parent.children || []).forEach((child) => {
              if (this.data.selectedCategoryIds.indexOf(child.id) >= 0) {
                categories.push({ name: child.name, type: parent.type });
              }
            });
          });
          payload.categories = categories;
        }
      }
      const result = await this.call("exportBills", payload);
      if (!result.fileID) throw new Error("云函数未返回文件 ID");

      this._setStage("downloading", "正在下载导出文件...", 0);
      const dl = await this._downloadFileWithProgress(result.fileID);
      if (!dl.tempFilePath) throw new Error("下载成功但未拿到临时文件路径");
      this.setData({ exportProgress: 100 });

      this._setStage("opening", "正在打开文件...");
      let savedFilePath = dl.tempFilePath;
      try {
        const saveRes = await wx.saveFile({ tempFilePath: dl.tempFilePath });
        if (saveRes && saveRes.savedFilePath) savedFilePath = saveRes.savedFilePath;
      } catch (e) {
        // saveFile 失败不影响打开，仍用 tempFilePath
      }
      try {
        await wx.openDocument({ filePath: savedFilePath, fileType: "xlsx", showMenu: true });
      } catch (e) {
        console.error("打开文档失败", e);
        throw new Error("文件打开失败：" + (e.errMsg || e.message || "未知错误"));
      }
      this._setStage("done", "导出完成", 100);
      setTimeout(() => {
        if (this.data.exportStage === "done") this.setData({ exporting: false, exportStage: "" });
      }, 600);
    } catch (error) {
      console.error("导出失败", error);
      const detail = error.message || "导出失败";
      this.setData({ exporting: false, exportStage: "" });
      wx.showModal({ title: "导出失败", content: detail, showCancel: false });
    }
  }
});
