const app = getApp();

const TYPE_OPTIONS = [
  { id: "expense", name: "支出" },
  { id: "income", name: "收入" }
];

Page({
  data: {
    // 时间
    filterMonth: "",
    filterDateStart: "",
    filterDateEnd: "",
    timeDisplay: "全部时间",
    timeMode: "all",
    quick: "thisMonth",
    tempMonth: "",
    tempDateStart: "",
    tempDateEnd: "",
    showTimeSheet: false,
    // 分类
    allCategories: [],
    categoryGroups: { expense: [], income: [] },
    allCategoryIds: [],
    selectedCategoryIds: [],
    tempCategoryIds: [],
    categoryDisplay: "全选",
    showCategorySheet: false,
    legacyCategory: null,
    // 账户
    accountList: [],
    selectedAccountIds: [],
    selectedAccountMap: {},
    accountDisplay: "全选",
    showAccountPanel: false,
    // 流水类型
    typeOptions: TYPE_OPTIONS,
    selectedTypes: [],
    selectedTypeMap: {},
    typeDisplay: "全选",
    showTypePanel: false,
    // 成员
    memberList: [],
    selectedMemberIds: [],
    selectedMemberMap: {},
    memberDisplay: "全选",
    showMemberPanel: false,
    // 其他
    merchant: "",
    minAmount: "",
    maxAmount: "",
    remark: ""
  },

  onLoad(options) {
    this._initFromOptions(options || {});
    this._loadOptions();
  },

  _parseArray(value) {
    if (!value) return [];
    try {
      const parsed = JSON.parse(decodeURIComponent(value));
      return Array.isArray(parsed) ? parsed.map((item) => String(item || "")) : [];
    } catch (error) {
      return [];
    }
  },

  _initFromOptions(options) {
    const decode = (value) => (value ? decodeURIComponent(value) : "");
    const filterMonth = decode(options.filterMonth);
    const filterDateStart = decode(options.filterDateStart);
    const filterDateEnd = decode(options.filterDateEnd);
    const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const thisMonth = now.getUTCFullYear() + "-" + String(now.getUTCMonth() + 1).padStart(2, "0");
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const lastMonth = prev.getUTCFullYear() + "-" + String(prev.getUTCMonth() + 1).padStart(2, "0");
    const patch = {
      filterMonth,
      filterDateStart,
      filterDateEnd,
      tempMonth: filterMonth || thisMonth,
      tempDateStart: filterDateStart,
      tempDateEnd: filterDateEnd,
      selectedTypes: this._parseArray(options.selectedTypes),
      selectedAccountIds: this._parseArray(options.selectedAccountIds),
      selectedMemberIds: this._parseArray(options.selectedMemberIds),
      selectedCategoryIds: this._parseArray(options.selectedCategoryIds),
      merchant: decode(options.merchant),
      minAmount: decode(options.minAmount),
      maxAmount: decode(options.maxAmount),
      remark: decode(options.remark)
    };

    if (filterDateStart || filterDateEnd) {
      patch.timeMode = "range";
      patch.quick = "custom";
      patch.timeDisplay = (filterDateStart || "") + " ~ " + (filterDateEnd || "");
    } else if (filterMonth) {
      patch.timeMode = "month";
      patch.quick = filterMonth === thisMonth ? "thisMonth" : (filterMonth === lastMonth ? "lastMonth" : "custom");
      patch.timeDisplay = filterMonth === thisMonth ? "本月" : (filterMonth === lastMonth ? "上月" : this._formatMonth(filterMonth));
    } else {
      patch.timeMode = "all";
      patch.quick = "all";
      patch.timeDisplay = "全部时间";
    }

    const legacyType = decode(options.filterType);
    if (legacyType && ["expense", "income"].includes(legacyType)) patch.selectedTypes = [legacyType];

    const legacyCategory = decode(options.filterCategory);
    if (legacyCategory) {
      patch.legacyCategory = {
        name: legacyCategory,
        level: decode(options.filterCategoryLevel),
        type: decode(options.filterCategoryType)
      };
    }

    if (patch.selectedTypes.length === 0) patch.selectedTypes = ["expense", "income"];
    patch.selectedTypeMap = this._boolMap(patch.selectedTypes);

    const legacyAccount = decode(options.filterAccount);
    if (legacyAccount && patch.selectedAccountIds.length === 0) patch.legacyAccountName = legacyAccount;

    const legacyMember = decode(options.filterMember);
    if (legacyMember && patch.selectedMemberIds.length === 0) patch.selectedMemberIds = [legacyMember];

    this.setData(patch);
  },

  async _loadOptions() {
    const familyId = app.globalData.currentFamilyId;
    if (!familyId) return;
    try {
      const res = await wx.cloud.callFunction({
        name: "accountingFunctions",
        data: { action: "listFormOptions", familyId }
      });
      const categories = res.result?.categories || [];
      const accounts = (res.result?.accounts || []).filter((item) => item.enabled !== false);
      const members = res.result?.members || [];
      const allCategoryIds = [];
      categories.forEach((parent) => (parent.children || []).forEach((child) => allCategoryIds.push(child.id)));

      let selectedCategoryIds = this.data.selectedCategoryIds.filter((id) => allCategoryIds.indexOf(id) >= 0);
      if (this.data.legacyCategory) selectedCategoryIds = this._resolveLegacyCategoryIds(categories, this.data.legacyCategory);
      if (selectedCategoryIds.length === 0) selectedCategoryIds = [...allCategoryIds];

      let selectedAccountIds = this.data.selectedAccountIds.filter((id) => accounts.some((account) => account._id === id));
      if (this.data.legacyAccountName) {
        const matched = accounts.find((account) => account.name === this.data.legacyAccountName);
        if (matched) selectedAccountIds = [matched._id];
      }
      if (selectedAccountIds.length === 0) selectedAccountIds = accounts.map((account) => account._id);

      let selectedMemberIds = this.data.selectedMemberIds.filter((id) => members.some((member) => member.memberId === id));
      if (selectedMemberIds.length === 0) selectedMemberIds = members.map((member) => member.memberId);

      const selectedTypes = this.data.selectedTypes.filter((type) => ["expense", "income"].includes(type));

      this.setData({
        allCategories: categories,
        allCategoryIds,
        accountList: accounts,
        memberList: members,
        selectedCategoryIds,
        selectedAccountIds,
        selectedMemberIds,
        selectedTypes: selectedTypes.length ? selectedTypes : ["expense", "income"],
        legacyCategory: null
      });
      this._syncMaps();
      this._refreshDisplays();
    } catch (error) {
      console.error("筛选页加载选项失败", error);
      wx.showToast({ title: "加载选项失败", icon: "none" });
    }
  },

  _resolveLegacyCategoryIds(categories, legacy) {
    const ids = [];
    categories.forEach((parent) => {
      if ((legacy.type || legacy.filterType) && parent.type !== (legacy.type || legacy.filterType)) return;
      if (legacy.level === "category1" && parent.name === legacy.name) {
        (parent.children || []).forEach((child) => ids.push(child.id));
      }
      (parent.children || []).forEach((child) => {
        if (legacy.level !== "category1" && child.name === legacy.name) ids.push(child.id);
      });
    });
    return Array.from(new Set(ids));
  },

  _boolMap(list) {
    const map = {};
    (list || []).forEach((id) => { map[id] = true; });
    return map;
  },

  _syncMaps() {
    this.setData({
      selectedAccountMap: this._boolMap(this.data.selectedAccountIds),
      selectedMemberMap: this._boolMap(this.data.selectedMemberIds),
      selectedTypeMap: this._boolMap(this.data.selectedTypes)
    });
  },

  _formatCount(selected, total, noneText) {
    if (total === 0) return noneText;
    if (selected.length === 0) return "未选";
    if (selected.length === total) return "全选";
    return "已选 " + selected.length + " / " + total;
  },

  _refreshDisplays() {
    this.setData({
      categoryDisplay: this._formatCount(this.data.selectedCategoryIds, this.data.allCategoryIds.length, "暂无分类"),
      accountDisplay: this._formatCount(this.data.selectedAccountIds, this.data.accountList.length, "暂无账户"),
      memberDisplay: this._formatCount(this.data.selectedMemberIds, this.data.memberList.length, "暂无成员"),
      typeDisplay: this._formatCount(this.data.selectedTypes, this.data.typeOptions.length, "暂无类型")
    });
  },

  stopPropagation() {},

  // ========== 时间 ==========
  openTimeSheet() {
    this.setData({
      showTimeSheet: true,
      tempMonth: this.data.filterMonth || this.data.tempMonth,
      tempDateStart: this.data.filterDateStart,
      tempDateEnd: this.data.filterDateEnd
    });
  },
  closeTimeSheet() {
    this.setData({ showTimeSheet: false });
  },
  selectQuick(e) {
    const key = e.currentTarget.dataset.key;
    const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const thisMonth = now.getUTCFullYear() + "-" + String(now.getUTCMonth() + 1).padStart(2, "0");
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const lastMonth = prev.getUTCFullYear() + "-" + String(prev.getUTCMonth() + 1).padStart(2, "0");
    const thisYearStart = now.getUTCFullYear() + "-01-01";
    const thisYearEnd = now.getUTCFullYear() + "-12-31";
    const patch = { quick: key };
    if (key === "thisMonth") {
      patch.timeMode = "month";
      patch.filterMonth = thisMonth;
      patch.filterDateStart = "";
      patch.filterDateEnd = "";
      patch.tempMonth = thisMonth;
      patch.timeDisplay = "本月";
    } else if (key === "lastMonth") {
      patch.timeMode = "month";
      patch.filterMonth = lastMonth;
      patch.filterDateStart = "";
      patch.filterDateEnd = "";
      patch.tempMonth = lastMonth;
      patch.timeDisplay = "上月";
    } else if (key === "thisYear") {
      patch.timeMode = "range";
      patch.filterMonth = "";
      patch.filterDateStart = thisYearStart;
      patch.filterDateEnd = thisYearEnd;
      patch.tempDateStart = thisYearStart;
      patch.tempDateEnd = thisYearEnd;
      patch.timeDisplay = "今年";
    } else if (key === "all") {
      patch.timeMode = "all";
      patch.filterMonth = "";
      patch.filterDateStart = "";
      patch.filterDateEnd = "";
      patch.timeDisplay = "全部时间";
    } else if (key === "customMonth") {
      patch.quick = "custom";
      patch.timeMode = "month";
      if (!this.data.tempMonth) patch.tempMonth = thisMonth;
      this.setData(patch);
      return;
    } else if (key === "customRange") {
      patch.quick = "custom";
      patch.timeMode = "range";
      if (!this.data.tempDateStart) patch.tempDateStart = thisMonth + "-01";
      if (!this.data.tempDateEnd) patch.tempDateEnd = now.getUTCFullYear() + "-" + String(now.getUTCMonth() + 1).padStart(2, "0") + "-" + String(now.getUTCDate()).padStart(2, "0");
      this.setData(patch);
      return;
    }
    this.setData(patch);
  },
  onTempMonthChange(e) {
    const value = e.detail.value;
    this.setData({
      tempMonth: value,
      quick: "custom",
      timeMode: "month",
      filterMonth: value,
      filterDateStart: "",
      filterDateEnd: "",
      timeDisplay: this._formatMonth(value)
    });
  },
  onTempStartChange(e) { this.setData({ tempDateStart: e.detail.value, quick: "custom" }); },
  onTempEndChange(e) { this.setData({ tempDateEnd: e.detail.value, quick: "custom" }); },
  confirmTimeSheet() {
    const { timeMode, tempMonth, tempDateStart, tempDateEnd } = this.data;
    const patch = { showTimeSheet: false };
    if (timeMode === "month" && tempMonth) {
      patch.filterMonth = tempMonth;
      patch.filterDateStart = "";
      patch.filterDateEnd = "";
      patch.timeDisplay = this._formatMonth(tempMonth);
    } else if (timeMode === "range" && (tempDateStart || tempDateEnd)) {
      if (tempDateStart && tempDateEnd && tempDateStart > tempDateEnd) {
        wx.showToast({ title: "开始日期不能晚于结束日期", icon: "none" });
        return;
      }
      patch.filterMonth = "";
      patch.filterDateStart = tempDateStart || "";
      patch.filterDateEnd = tempDateEnd || "";
      patch.timeDisplay = (tempDateStart || "*") + " ~ " + (tempDateEnd || "*");
    }
    this.setData(patch);
  },
  _formatMonth(month) {
    const [year, mon] = String(month || "").split("-");
    return year && mon ? year + "年" + Number(mon) + "月" : "全部时间";
  },

  // ========== 分类 ==========
  _buildCategoryGroups(selectedIds) {
    const selected = selectedIds || [];
    const buildOne = (parent) => {
      const children = (parent.children || []).map((child) => ({
        id: child.id,
        name: child.name,
        icon: child.icon || "📝",
        active: selected.indexOf(child.id) >= 0
      }));
      if (!children.length) return null;
      const activeCount = children.filter((child) => child.active).length;
      return {
        id: parent.id,
        name: parent.name,
        icon: parent.icon || "📂",
        type: parent.type,
        typeLabel: parent.type === "income" ? "收入" : "支出",
        active: activeCount === children.length,
        children
      };
    };
    const expense = [];
    const income = [];
    (this.data.allCategories || []).forEach((parent) => {
      const group = buildOne(parent);
      if (!group) return;
      if (parent.type === "income") income.push(group);
      else expense.push(group);
    });
    return { expense, income };
  },
  openCategorySheet() {
    this.setData({
      showCategorySheet: true,
      tempCategoryIds: [...this.data.selectedCategoryIds],
      categoryGroups: this._buildCategoryGroups(this.data.selectedCategoryIds)
    });
  },
  closeCategorySheet() {
    this.setData({ showCategorySheet: false });
  },
  selectAllCategories() {
    const all = this.data.allCategoryIds;
    const isAll = all.length > 0 && this.data.tempCategoryIds.length === all.length;
    const next = isAll ? [] : [...all];
    this.setData({ tempCategoryIds: next, categoryGroups: this._buildCategoryGroups(next) });
  },
  toggleParentCategory(e) {
    const id = e.currentTarget.dataset.id;
    const parent = this.data.allCategories.find((item) => item.id === id);
    if (!parent || !parent.children || !parent.children.length) return;
    const childIds = parent.children.map((child) => child.id);
    const allSelected = childIds.every((childId) => this.data.tempCategoryIds.indexOf(childId) >= 0);
    const next = allSelected
      ? this.data.tempCategoryIds.filter((childId) => childIds.indexOf(childId) < 0)
      : Array.from(new Set(this.data.tempCategoryIds.concat(childIds)));
    this.setData({ tempCategoryIds: next, categoryGroups: this._buildCategoryGroups(next) });
  },
  toggleChildCategory(e) {
    const id = e.currentTarget.dataset.id;
    const next = this.data.tempCategoryIds.indexOf(id) >= 0
      ? this.data.tempCategoryIds.filter((item) => item !== id)
      : this.data.tempCategoryIds.concat(id);
    this.setData({ tempCategoryIds: next, categoryGroups: this._buildCategoryGroups(next) });
  },
  confirmCategorySheet() {
    if (this.data.tempCategoryIds.length === 0) {
      wx.showToast({ title: "请至少选择一个分类", icon: "none" });
      return;
    }
    this.setData({
      selectedCategoryIds: this.data.tempCategoryIds,
      showCategorySheet: false
    });
    this._refreshDisplays();
  },

  // ========== 行内多选 ==========
  toggleAccountPanel() {
    this.setData({
      showAccountPanel: !this.data.showAccountPanel,
      showTypePanel: false,
      showMemberPanel: false
    });
  },
  toggleTypePanel() {
    this.setData({
      showTypePanel: !this.data.showTypePanel,
      showAccountPanel: false,
      showMemberPanel: false
    });
  },
  toggleMemberPanel() {
    this.setData({
      showMemberPanel: !this.data.showMemberPanel,
      showAccountPanel: false,
      showTypePanel: false
    });
  },
  toggleAccount(e) {
    this._toggleList("selectedAccountIds", e.currentTarget.dataset.id, "selectedAccountMap");
  },
  toggleType(e) {
    this._toggleList("selectedTypes", e.currentTarget.dataset.id, "selectedTypeMap");
  },
  toggleMember(e) {
    this._toggleList("selectedMemberIds", e.currentTarget.dataset.id, "selectedMemberMap");
  },
  _toggleList(listKey, id, mapKey) {
    const list = this.data[listKey];
    const next = list.indexOf(id) >= 0 ? list.filter((item) => item !== id) : list.concat(id);
    this.setData({ [listKey]: next, [mapKey]: this._boolMap(next) });
    this._refreshDisplays();
  },

  // ========== 其他筛选 ==========
  onMerchantInput(e) { this.setData({ merchant: (e.detail.value || "").trim() }); },
  onMinAmountInput(e) { this.setData({ minAmount: e.detail.value }); },
  onMinAmountBlur(e) { this._validateAmount("minAmount", e.detail.value); },
  onMaxAmountInput(e) { this.setData({ maxAmount: e.detail.value }); },
  onMaxAmountBlur(e) { this._validateAmount("maxAmount", e.detail.value); },
  _validateAmount(field, raw) {
    const value = (raw || "").trim();
    if (value && !/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(value)) {
      wx.showToast({ title: "请输入有效金额", icon: "none" });
      this.setData({ [field]: "" });
    } else {
      this.setData({ [field]: value });
    }
  },
  onRemarkInput(e) { this.setData({ remark: (e.detail.value || "").slice(0, 50) }); },

  // ========== 重置 / 确定 ==========
  onReset() {
    const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const thisMonth = now.getUTCFullYear() + "-" + String(now.getUTCMonth() + 1).padStart(2, "0");
    this.setData({
      filterMonth: thisMonth,
      filterDateStart: "",
      filterDateEnd: "",
      timeMode: "month",
      quick: "thisMonth",
      tempMonth: thisMonth,
      tempDateStart: "",
      tempDateEnd: "",
      timeDisplay: "本月",
      selectedCategoryIds: [...this.data.allCategoryIds],
      selectedAccountIds: this.data.accountList.map((account) => account._id),
      selectedTypes: ["expense", "income"],
      selectedMemberIds: this.data.memberList.map((member) => member.memberId),
      showAccountPanel: false,
      showTypePanel: false,
      showMemberPanel: false,
      merchant: "",
      minAmount: "",
      maxAmount: "",
      remark: ""
    });
    this._syncMaps();
    this._refreshDisplays();
  },

  onConfirm() {
    const min = parseFloat(this.data.minAmount);
    const max = parseFloat(this.data.maxAmount);
    if (!isNaN(min) && !isNaN(max) && min > max) {
      wx.showToast({ title: "最低金额不能大于最高金额", icon: "none" });
      return;
    }
    if (this.data.selectedCategoryIds.length === 0) {
      wx.showToast({ title: "请至少选择一个分类", icon: "none" });
      return;
    }
    if (this.data.selectedAccountIds.length === 0) {
      wx.showToast({ title: "请至少选择一个账户", icon: "none" });
      return;
    }
    if (this.data.selectedTypes.length === 0) {
      wx.showToast({ title: "请至少选择一个流水类型", icon: "none" });
      return;
    }
    if (this.data.selectedMemberIds.length === 0) {
      wx.showToast({ title: "请至少选择一个成员", icon: "none" });
      return;
    }
    const pages = getCurrentPages();
    const prevPage = pages[pages.length - 2];
    if (prevPage) prevPage.onFilterConfirm(this._buildResult());
    wx.navigateBack();
  },

  _buildResult() {
    const result = {
      selectedCategoryIds: this.data.selectedCategoryIds,
      selectedAccountIds: this.data.selectedAccountIds,
      selectedMemberIds: this.data.selectedMemberIds,
      selectedTypes: this.data.selectedTypes,
      merchant: this.data.merchant,
      minAmount: this.data.minAmount,
      maxAmount: this.data.maxAmount,
      remark: this.data.remark
    };
    if (this.data.filterDateStart || this.data.filterDateEnd) {
      result.filterDateStart = this.data.filterDateStart;
      result.filterDateEnd = this.data.filterDateEnd;
      result.filterMonth = "";
    } else {
      result.filterMonth = this.data.filterMonth;
      result.filterDateStart = "";
      result.filterDateEnd = "";
    }
    return result;
  }
});
