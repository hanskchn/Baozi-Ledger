const app = getApp();
const { debounce, throttle } = require("../../utils/perf");
const { callFunction } = require("../../utils/api.js");
const { resolveSwipeDirection, swipeOffsetRpx } = require("../../utils/swipe.js");

const BILLS_CACHE_TTL_MS = 60 * 1000;

Page({
  data: {
    bills: [],
    filterMonth: "",
    selectedCategoryIds: [],
    legacyCategoryNames: [],
    legacyCategoryType: "",
    selectedAccountIds: [],
    selectedMemberIds: [],
    selectedTypes: [],
    filterDateStart: "",
    filterDateEnd: "",
    filterMinAmount: "",
    filterMaxAmount: "",
    sort: "dateDesc",
    merchant: "",
    remark: "",
    activeFilterTags: [],
    hasActiveFilters: false,
    activeFilterCount: 0,
    periodDisplay: "",
    showTimeSheet: false,
    timeMode: "month",
    quick: "thisMonth",
    tempMonth: "",
    tempDateStart: "",
    tempDateEnd: "",
    categories: [],
    members: [],
    accounts: [],
    offset: 0,
    hasMore: true,
    loadingMore: false,
    loading: false,
    loadedFamilyId: "",
    slidBillId: "",
    swipeOffsetMap: {},
    swipeAnimating: false
  },

  onLoad() {
    const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const month = now.getUTCFullYear() + "-" + String(now.getUTCMonth() + 1).padStart(2, "0");
    this.setData({ filterMonth: month });
    this._debouncedLoadBills = debounce(() => this.loadBills(), 200);
    this._throttledLoadMore = throttle(() => this.loadBills(true), 200);
  },

  buildBillsCacheKey() {
    const familyId = app.globalData.currentFamilyId;
    if (!familyId) return null;
    const filterObj = {
      month: this.data.filterMonth,
      categories: this.data.selectedCategoryIds,
      accounts: this.data.selectedAccountIds,
      members: this.data.selectedMemberIds,
      types: this.data.selectedTypes,
      dateStart: this.data.filterDateStart,
      dateEnd: this.data.filterDateEnd,
      minAmount: this.data.filterMinAmount,
      maxAmount: this.data.filterMaxAmount,
      merchant: this.data.merchant,
      remark: this.data.remark,
      sort: this.data.sort
    };
    const filterKey = Object.keys(filterObj).sort().map((k) => k + "=" + JSON.stringify(filterObj[k])).join("|");
    return `bills:${familyId}:${filterKey}`;
  },

  async onShow() {
    try {
      await app.ensureInitialized();
      const familyId = app.globalData.currentFamilyId;
      const pendingFilter = app.globalData.pendingBillsFilter;
      if (pendingFilter) app.globalData.pendingBillsFilter = null;
      if (this.data.loadedFamilyId && this.data.loadedFamilyId !== familyId) {
        this.setData({
          selectedCategoryIds: [], legacyCategoryNames: [], legacyCategoryType: "",
          selectedAccountIds: [], selectedMemberIds: [], selectedTypes: [],
          filterDateStart: "", filterDateEnd: "",
          filterMinAmount: "", filterMaxAmount: "",
          merchant: "", remark: "", sort: "dateDesc",
          offset: 0
        });
      }
      this.setData({ loadedFamilyId: familyId });
      if (pendingFilter) {
        await this.loadOptions();
        this._applyFilterResult(pendingFilter);
        this._debouncedLoadBills();
        return;
      }
      if (app.globalData.billsDirty === true) {
        app.globalData.billsDirty = false;
        this.setData({ offset: 0 });
        this._updateActiveFilterTags();
        if (this.data.categories.length === 0 || this.data.accounts.length === 0 || this.data.members.length === 0) {
          await this.loadOptions();
        }
        await this.loadBills(false, true);
        return;
      }
      this._updateActiveFilterTags();
      const optionsReady = this.data.categories.length > 0 && this.data.accounts.length > 0 && this.data.members.length > 0;
      await Promise.all([optionsReady ? Promise.resolve() : this.loadOptions(), this.loadBills()]);
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    }
  },

  onFamilyChanged() {
    const newFamilyId = app.globalData.currentFamilyId;
    if (newFamilyId && newFamilyId === this.data.loadedFamilyId) return;
    try {
      wx.getStorageInfoSync && (() => {
        const info = wx.getStorageInfoSync();
        info.keys.forEach((k) => { if (k.startsWith("bills:")) wx.removeStorageSync(k); });
      })();
    } catch (error) { /* ignore */ }
    this.setData({
      bills: [],
      selectedCategoryIds: [], legacyCategoryNames: [], legacyCategoryType: "",
      selectedAccountIds: [], selectedMemberIds: [], selectedTypes: [],
      filterDateStart: "", filterDateEnd: "",
      filterMinAmount: "", filterMaxAmount: "", merchant: "", remark: "",
      sort: "dateDesc", offset: 0, hasMore: true, loadingMore: false,
      loadedFamilyId: newFamilyId
    });
    this.loadOptions().then(() => this.loadBills()).catch(() => {});
  },

  async loadOptions() {
    try {
      const familyId = app.globalData.currentFamilyId;
      if (!familyId) return;
      const res = await callFunction("accountingFunctions", "listFormOptions", { familyId });
      this.setData({
        categories: res.result?.categories || [],
        members: res.result?.members || [],
        accounts: res.result?.accounts || []
      });
    } catch (error) {
      console.error("加载选项失败", error);
    }
  },

  async loadBills(append, forceRefresh) {
    try {
      const familyId = app.globalData.currentFamilyId;
      if (!familyId) return;
      if (!append && this.data.bills.length === 0) this.setData({ loading: true });
      const cacheKey = this.buildBillsCacheKey();
      if (!forceRefresh && !append && this.data.offset === 0 && cacheKey) {
        let cached = null;
        try { cached = wx.getStorageSync(cacheKey); } catch (error) { cached = null; }
        if (cached && cached.bills && Date.now() - cached.ts < BILLS_CACHE_TTL_MS) {
          const bills = cached.bills.map(bill => ({ ...bill, displayTime: (bill.date || "").substring(11, 16) }));
          this.setData({ bills, billGroups: this._groupBills(bills), hasMore: bills.length === 20, loadingMore: false, loading: false });
          return;
        }
      }
      const result = await this.callFunction("listBills", {
        familyId,
        month: this.data.filterMonth,
        ...this._buildCloudFilters(),
        dateStart: this.data.filterDateStart,
        dateEnd: this.data.filterDateEnd,
        minAmount: this.data.filterMinAmount,
        maxAmount: this.data.filterMaxAmount,
        merchant: this.data.merchant,
        remark: this.data.remark,
        sort: this.data.sort,
        offset: this.data.offset,
        limit: 20
      });
      const incoming = (result.bills || []).map(bill => ({
        ...bill,
        displayAmount: (bill.amount / 100).toFixed(2),
        displayTime: (bill.date || "").substring(11, 16)
      }));
      const bills = append ? this.data.bills.concat(incoming) : incoming;
      this.setData({ bills, billGroups: this._groupBills(bills), hasMore: incoming.length === 20, loadingMore: false, loading: false });
      if (!append && this.data.offset === 0 && cacheKey) {
        try { wx.setStorageSync(cacheKey, { ts: Date.now(), bills }); } catch (storageError) { console.warn("账单缓存写入失败", storageError); }
      }
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
      if (append) this.setData({ offset: Math.max(0, this.data.offset - 20), loadingMore: false });
      else this.setData({ loadingMore: false, loading: false });
    }
  },

  changeMonth(e) {
    const delta = Number(e.currentTarget.dataset.delta);
    if (!this.data.filterMonth) {
      const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
      this.setData({
        filterMonth: this._shiftMonth(now.getUTCFullYear(), now.getUTCMonth() + 1, delta),
        filterDateStart: "",
        filterDateEnd: ""
      });
      this._updateActiveFilterTags();
      this._debouncedLoadBills();
      return;
    }
    const [year, mon] = this.data.filterMonth.split("-").map(Number);
    const newMonth = this._shiftMonth(year, mon, delta);
    this.setData({ filterMonth: newMonth, filterDateStart: "", filterDateEnd: "" });
    this._updateActiveFilterTags();
    this._debouncedLoadBills();
  },

  _shiftMonth(year, monthOneBased, delta) {
    const totalMonths = year * 12 + (monthOneBased - 1) + delta;
    const nextYear = Math.floor(totalMonths / 12);
    const nextMonth = totalMonths % 12 + 1;
    return nextYear + "-" + String(nextMonth).padStart(2, "0");
  },

  openTimeSheet() {
    const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const thisMonth = now.getUTCFullYear() + "-" + String(now.getUTCMonth() + 1).padStart(2, "0");
    const hasRange = !!this.data.filterDateStart || !!this.data.filterDateEnd;
    let quick = "custom";
    if (hasRange) {
      const y = now.getUTCFullYear();
      if (this.data.filterDateStart === y + "-01-01" && this.data.filterDateEnd === y + "-12-31") quick = "thisYear";
    } else if (this.data.filterMonth === thisMonth) quick = "thisMonth";
    else {
      const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      const lastMonth = prev.getUTCFullYear() + "-" + String(prev.getUTCMonth() + 1).padStart(2, "0");
      if (this.data.filterMonth === lastMonth) quick = "lastMonth";
      else if (!this.data.filterMonth) quick = "all";
    }
    this.setData({
      showTimeSheet: true,
      quick,
      timeMode: hasRange ? "range" : "month",
      tempMonth: this.data.filterMonth || thisMonth,
      tempDateStart: this.data.filterDateStart,
      tempDateEnd: this.data.filterDateEnd
    });
  },
  closeTimeSheet() {
    this.setData({ showTimeSheet: false });
  },
  stopPropagation() {},
  selectQuick(e) {
    const key = e.currentTarget.dataset.key;
    const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const y = now.getUTCFullYear();
    const thisMonth = y + "-" + String(now.getUTCMonth() + 1).padStart(2, "0");
    const prev = new Date(Date.UTC(y, now.getUTCMonth() - 1, 1));
    const lastMonth = prev.getUTCFullYear() + "-" + String(prev.getUTCMonth() + 1).padStart(2, "0");
    if (key === "thisMonth") {
      this._applyTime({ quick: "thisMonth", timeMode: "month", filterMonth: thisMonth, filterDateStart: "", filterDateEnd: "", tempMonth: thisMonth });
      this.closeTimeSheet();
    } else if (key === "lastMonth") {
      this._applyTime({ quick: "lastMonth", timeMode: "month", filterMonth: lastMonth, filterDateStart: "", filterDateEnd: "", tempMonth: lastMonth });
      this.closeTimeSheet();
    } else if (key === "thisYear") {
      this._applyTime({ quick: "thisYear", timeMode: "range", filterMonth: "", filterDateStart: y + "-01-01", filterDateEnd: y + "-12-31", tempDateStart: y + "-01-01", tempDateEnd: y + "-12-31" });
      this.closeTimeSheet();
    } else if (key === "all") {
      this._applyTime({ quick: "all", timeMode: "all", filterMonth: "", filterDateStart: "", filterDateEnd: "", tempMonth: "", tempDateStart: "", tempDateEnd: "" });
      this.closeTimeSheet();
    } else if (key === "customMonth") {
      this.setData({ quick: "custom", timeMode: "month" });
    } else if (key === "customRange") {
      this.setData({ quick: "custom", timeMode: "range" });
    }
  },
  onTempMonthChange(e) {
    const value = e.detail.value;
    this.setData({ quick: "custom", timeMode: "month" });
    this._applyTime({ filterMonth: value, filterDateStart: "", filterDateEnd: "" });
  },
  onTempStartChange(e) {
    const value = e.detail.value;
    this.setData({ quick: "custom", timeMode: "range", tempDateStart: value });
    if (this.data.tempDateEnd) {
      this._applyTime({ filterMonth: "", filterDateStart: value, filterDateEnd: this.data.tempDateEnd });
      this.closeTimeSheet();
    }
  },
  onTempEndChange(e) {
    const value = e.detail.value;
    this.setData({ quick: "custom", timeMode: "range", tempDateEnd: value });
    if (this.data.tempDateStart) {
      this._applyTime({ filterMonth: "", filterDateStart: this.data.tempDateStart, filterDateEnd: value });
      this.closeTimeSheet();
    }
  },
  _applyTime(patch) {
    this.setData({ ...patch, offset: 0 });
    this._updateActiveFilterTags();
    this._debouncedLoadBills();
  },

  _resolveLegacyCategoryIds(result) {
    // 统计页下钻可能传 names 数组（饼图「其他」合并扇区会带真实分类名清单）；
    // 二级名精确匹配优先，一级名整组兜底；仍匹配不到的（导入遗留名/已删改名等）原样返回，
    // 由 _buildCloudFilters 直传云端按 category1/category2 原文匹配，避免只剩类型筛选。
    const rawNames = Array.isArray(result.filterCategoryNames) && result.filterCategoryNames.length
      ? result.filterCategoryNames
      : (result.filterCategory ? [result.filterCategory] : []);
    const names = rawNames.map((name) => String(name || "").trim()).filter(Boolean);
    if (names.length === 0) return { ids: [], names: [] };
    const type = result.filterCategoryType || result.filterType;
    const category1Mode = result.filterCategoryLevel === "category1";
    const parents = (this.data.categories || []).filter((parent) => !type || parent.type === type);
    const ids = [];
    const resolved = new Set();
    names.forEach((name) => {
      let matched = [];
      parents.forEach((parent) => {
        (parent.children || []).forEach((child) => {
          if (!category1Mode && child.name === name) matched.push(child.id);
        });
      });
      if (matched.length === 0) {
        parents.forEach((parent) => {
          if (parent.name === name) (parent.children || []).forEach((child) => matched.push(child.id));
        });
      }
      if (matched.length > 0) {
        matched.forEach((id) => ids.push(id));
        resolved.add(name);
      }
    });
    return { ids: Array.from(new Set(ids)), names: names.filter((name) => !resolved.has(name)) };
  },

  _normalizeFilterResult(result) {
    const hasDateRange = !!result.filterDateStart || !!result.filterDateEnd;
    let selectedCategoryIds = [];
    let legacyCategoryNames = [];
    let legacyCategoryType = "";
    if (Array.isArray(result.selectedCategoryIds)) {
      selectedCategoryIds = result.selectedCategoryIds;
    } else {
      const resolved = this._resolveLegacyCategoryIds(result);
      selectedCategoryIds = resolved.ids;
      legacyCategoryNames = resolved.names;
      legacyCategoryType = result.filterCategoryType || result.filterType || "";
    }
    const selectedAccountIds = Array.isArray(result.selectedAccountIds)
      ? result.selectedAccountIds
      : (result.filterAccount ? (this.data.accounts || []).filter((account) => account.name === result.filterAccount).map((account) => account._id) : []);
    const selectedMemberIds = Array.isArray(result.selectedMemberIds)
      ? result.selectedMemberIds
      : (result.filterMember ? [result.filterMember] : []);
    const selectedTypes = Array.isArray(result.selectedTypes)
      ? result.selectedTypes
      : (result.filterType ? [result.filterType] : []);
    return {
      filterMonth: hasDateRange ? "" : (result.filterMonth || this.data.filterMonth || ""),
      filterDateStart: result.filterDateStart || "",
      filterDateEnd: result.filterDateEnd || "",
      selectedCategoryIds,
      legacyCategoryNames,
      legacyCategoryType,
      selectedAccountIds,
      selectedMemberIds,
      selectedTypes,
      merchant: result.merchant || "",
      filterMinAmount: result.minAmount || "",
      filterMaxAmount: result.maxAmount || "",
      remark: result.remark || "",
      offset: 0
    };
  },

  _applyFilterResult(result) {
    this.setData(this._normalizeFilterResult(result));
    this._updateActiveFilterTags();
  },

  _buildCloudFilters() {
    const filters = {};
    const categoryMap = {};
    const allCategoryIds = [];
    (this.data.categories || []).forEach((parent) => {
      (parent.children || []).forEach((child) => {
        allCategoryIds.push(child.id);
        categoryMap[child.id] = { name: child.name, type: parent.type };
      });
    });
    const selectedCategoryIds = this.data.selectedCategoryIds || [];
    const legacyCategoryNames = this.data.legacyCategoryNames || [];
    if ((selectedCategoryIds.length > 0 && selectedCategoryIds.length < allCategoryIds.length) || legacyCategoryNames.length > 0) {
      const categoryFilters = selectedCategoryIds.map((id) => categoryMap[id]).filter(Boolean);
      legacyCategoryNames.forEach((name) => {
        if (!categoryFilters.some((item) => item.name === name)) {
          categoryFilters.push({ name, type: this.data.legacyCategoryType || undefined });
        }
      });
      filters.categories = categoryFilters;
    }

    const accounts = this.data.accounts || [];
    const selectedAccountIds = this.data.selectedAccountIds || [];
    if (selectedAccountIds.length > 0 && selectedAccountIds.length < accounts.length) {
      filters.accounts = accounts.filter((account) => selectedAccountIds.indexOf(account._id) >= 0).map((account) => account.name);
    }

    const members = this.data.members || [];
    const selectedMemberIds = this.data.selectedMemberIds || [];
    if (selectedMemberIds.length > 0 && selectedMemberIds.length < members.length) {
      filters.memberIds = selectedMemberIds;
    }

    const selectedTypes = this.data.selectedTypes || [];
    if (selectedTypes.length > 0 && selectedTypes.length < 2) {
      filters.types = selectedTypes;
    }
    return filters;
  },

  clearFilters() {
    const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const thisMonth = now.getUTCFullYear() + "-" + String(now.getUTCMonth() + 1).padStart(2, "0");
    this.setData({
      filterMonth: thisMonth,
      filterDateStart: "", filterDateEnd: "",
      selectedCategoryIds: [], legacyCategoryNames: [], legacyCategoryType: "",
      selectedAccountIds: [], selectedMemberIds: [], selectedTypes: [],
      merchant: "", filterMinAmount: "", filterMaxAmount: "", remark: "",
      offset: 0
    });
    this._updateActiveFilterTags();
    this._debouncedLoadBills();
  },

  removeFilterTag(e) {
    const key = e.currentTarget.dataset.key;
    const patch = { offset: 0 };
    if (key === "category") { patch.selectedCategoryIds = []; patch.legacyCategoryNames = []; patch.legacyCategoryType = ""; }
    else if (key === "member") patch.selectedMemberIds = [];
    else if (key === "account") patch.selectedAccountIds = [];
    else if (key === "type") patch.selectedTypes = [];
    else if (key === "merchant") patch.merchant = "";
    else if (key === "amount") { patch.filterMinAmount = ""; patch.filterMaxAmount = ""; }
    else if (key === "remark") patch.remark = "";
    this.setData(patch);
    this._updateActiveFilterTags();
    this._debouncedLoadBills();
  },

  openFilter() {
    const params = [
      "filterMonth=" + encodeURIComponent(this.data.filterMonth || ""),
      "filterDateStart=" + encodeURIComponent(this.data.filterDateStart || ""),
      "filterDateEnd=" + encodeURIComponent(this.data.filterDateEnd || ""),
      "selectedCategoryIds=" + encodeURIComponent(JSON.stringify(this.data.selectedCategoryIds || [])),
      "selectedAccountIds=" + encodeURIComponent(JSON.stringify(this.data.selectedAccountIds || [])),
      "selectedMemberIds=" + encodeURIComponent(JSON.stringify(this.data.selectedMemberIds || [])),
      "selectedTypes=" + encodeURIComponent(JSON.stringify(this.data.selectedTypes || [])),
      "merchant=" + encodeURIComponent(this.data.merchant || ""),
      "minAmount=" + encodeURIComponent(this.data.filterMinAmount || ""),
      "maxAmount=" + encodeURIComponent(this.data.filterMaxAmount || ""),
      "remark=" + encodeURIComponent(this.data.remark || "")
    ].join("&");
    wx.navigateTo({ url: "/pages/filter/index?" + params });
  },

  onFilterConfirm(result) {
    this._applyFilterResult(result);
    this._debouncedLoadBills();
  },

  _computePeriodDisplay() {
    if (this.data.filterDateStart || this.data.filterDateEnd) {
      const start = this.data.filterDateStart || "";
      const end = this.data.filterDateEnd || "";
      const fmt = (d) => {
        if (!d) return "";
        const [y, m, day] = d.split("-");
        return Number(y) + "年" + Number(m) + "月" + Number(day) + "日";
      };
      const sameYear = start && end && start.substring(0, 4) === end.substring(0, 4);
      if (start && end && start === end) return fmt(start);
      if (start && end && sameYear) {
        const shortFmt = (d) => {
          const [, m, day] = d.split("-");
          return Number(m) + "月" + Number(day) + "日";
        };
        return start.substring(0, 4) + "年" + shortFmt(start) + " ~ " + shortFmt(end);
      }
      if (start && end) return fmt(start) + " ~ " + fmt(end);
      return fmt(start) || fmt(end);
    }
    const month = this.data.filterMonth;
    if (/^\d{4}-\d{2}$/.test(month || "")) {
      const [year, mon] = month.split("-").map(Number);
      return year + "年" + mon + "月";
    }
    return month || "全部时间";
  },

  _groupBills(bills) {
    const weekdayNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    const groups = [];
    const indexMap = {};
    (bills || []).forEach((bill) => {
      const day = (bill.date || "").substring(0, 10);
      if (!day) return;
      if (indexMap[day] === undefined) {
        const [year, month, date] = day.split("-").map(Number);
        const weekday = new Date(year, month - 1, date).getDay();
        indexMap[day] = groups.length;
        groups.push({
          day,
          title: year + "年" + month + "月" + date + "日 " + weekdayNames[weekday],
          expense: 0,
          income: 0,
          items: []
        });
      }
      const group = groups[indexMap[day]];
      const amountYuan = Number(bill.amount || 0) / 100;
      if (bill.type === "expense") group.expense += amountYuan;
      else if (bill.type === "income") group.income += amountYuan;
      group.items.push(bill);
    });
    groups.forEach((group) => {
      group.expense = group.expense.toFixed(2);
      group.income = group.income.toFixed(2);
    });
    return groups;
  },

  _updateActiveFilterTags() {
    const tags = [];
    const categoryCount = (this.data.selectedCategoryIds || []).length;
    const legacyCategoryNames = this.data.legacyCategoryNames || [];
    const allCategoryCount = (this.data.categories || []).reduce((sum, parent) => sum + ((parent.children || []).length), 0);
    if ((categoryCount > 0 && categoryCount < allCategoryCount) || legacyCategoryNames.length > 0) {
      tags.push({ key: "category", label: (categoryCount > 0 ? categoryCount : legacyCategoryNames.length) + "个分类" });
    }

    const selectedMemberIds = this.data.selectedMemberIds || [];
    if (selectedMemberIds.length > 0 && selectedMemberIds.length < (this.data.members || []).length) {
      tags.push({ key: "member", label: selectedMemberIds.length + "个成员" });
    }

    const selectedAccountIds = this.data.selectedAccountIds || [];
    if (selectedAccountIds.length > 0 && selectedAccountIds.length < (this.data.accounts || []).length) {
      tags.push({ key: "account", label: selectedAccountIds.length + "个账户" });
    }

    const selectedTypes = this.data.selectedTypes || [];
    if (selectedTypes.length === 1) tags.push({ key: "type", label: selectedTypes[0] === "expense" ? "支出" : "收入" });
    if (this.data.merchant) tags.push({ key: "merchant", label: this.data.merchant });
    if (this.data.filterMinAmount || this.data.filterMaxAmount) tags.push({ key: "amount", label: (this.data.filterMinAmount || "0") + "~" + (this.data.filterMaxAmount || "∞") });
    if (this.data.remark) tags.push({ key: "remark", label: this.data.remark });
    this.setData({
      activeFilterTags: tags,
      activeFilterCount: tags.length,
      hasActiveFilters: tags.length > 0,
      periodDisplay: this._computePeriodDisplay()
    });
  },

  callFunction(type, data = {}) { return callFunction("accountingFunctions", type, data); },

  goSearch() {
    wx.navigateTo({ url: "/pages/search/index" });
  },

  onReachBottom() {
    if (!this.data.hasMore || this.data.loadingMore) return;
    this.setData({ offset: this.data.offset + 20, loadingMore: true });
    this._throttledLoadMore();
  },

  async onPullDownRefresh() {
    this.setData({ offset: 0 });
    app.globalData.billsDirty = true;
    const cacheKey = this.buildBillsCacheKey();
    if (cacheKey) { try { wx.removeStorageSync(cacheKey); } catch (error) { /* ignore */ } }
    await this.loadBills(false, true);
    wx.stopPullDownRefresh();
  },

  onSwipeStart(e) {
    const billId = e.currentTarget.dataset.id;
    const canOperate = e.currentTarget.dataset.canOperate === "true" || e.currentTarget.dataset.canOperate === true;
    if (!canOperate) return;
    if (this.data.slidBillId && this.data.slidBillId !== billId) { this.setData({ slidBillId: "" }); }
    const touch = e.touches[0];
    this._swipeStartX = touch.clientX;
    this._swipeStartY = touch.clientY;
    this._swipeBillId = billId;
    this._swipeBaseX = this.data.slidBillId === billId ? -180 : 0;
    this._isDragging = false;
    this._dragDirection = null;
    this.setData({ swipeAnimating: true });
  },

  onSwipeMove(e) {
    const billId = e.currentTarget.dataset.id;
    if (!this._swipeBillId || this._swipeBillId !== billId) return;
    const canOperate = e.currentTarget.dataset.canOperate === "true" || e.currentTarget.dataset.canOperate === true;
    if (!canOperate) return;
    const touch = e.touches[0];
    const deltaX = touch.clientX - this._swipeStartX;
    const deltaY = touch.clientY - this._swipeStartY;
    if (!this._dragDirection) {
      const direction = resolveSwipeDirection(deltaX, deltaY);
      if (direction === null) return;
      this._dragDirection = direction;
      if (direction === "vertical") { this._swipeBillId = null; return; }
      this._isDragging = true;
    }
    if (this._dragDirection !== "horizontal") return;
    const sysInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const rpxRatio = 750 / sysInfo.windowWidth;
    const offsetRpx = swipeOffsetRpx(this._swipeBaseX, deltaX, rpxRatio);
    const map = {};
    map[billId] = offsetRpx;
    this.setData({ swipeOffsetMap: Object.assign({}, this.data.swipeOffsetMap, map) });
  },

  onSwipeEnd(e) {
    const billId = e.currentTarget.dataset.id;
    if (!this._swipeBillId || this._swipeBillId !== billId) return;
    const canOperate = e.currentTarget.dataset.canOperate === "true" || e.currentTarget.dataset.canOperate === true;
    this._swipeBillId = null;
    if (!canOperate) { this.setData({ slidBillId: "", swipeAnimating: false, swipeOffsetMap: {} }); return; }
    const currentOffset = this.data.swipeOffsetMap[billId] !== undefined
      ? this.data.swipeOffsetMap[billId]
      : (this.data.slidBillId === billId ? -180 : 0);
    const shouldOpen = currentOffset < -90;
    this.setData({ slidBillId: shouldOpen ? billId : "", swipeAnimating: false, swipeOffsetMap: {} });
  },

  onItemTap(e) {
    const billId = e.currentTarget.dataset.id;
    if (this.data.slidBillId === billId) { this.setData({ slidBillId: "" }); return; }
    const canOperate = e.currentTarget.dataset.canOperate === "true" || e.currentTarget.dataset.canOperate === true;
    const bill = this.data.bills.find((item) => item._id === billId);
    if (canOperate) {
      wx.navigateTo({ url: "/pages/addBill/index?billId=" + billId + (bill ? "&type=" + bill.type : "") });
    } else {
      wx.navigateTo({ url: "/pages/billDetail/index?id=" + billId });
    }
  },

  onDeleteTap(e) {
    const billId = e.currentTarget.dataset.id;
    const canOperate = e.currentTarget.dataset.canOperate === "true" || e.currentTarget.dataset.canOperate === true;
    if (!canOperate) { wx.showToast({ title: "无删除权限", icon: "none" }); return; }
    const bill = this.data.bills.find((item) => item._id === billId);
    if (!bill) return;
    const self = this;
    wx.showModal({
      title: "删除账单",
      content: "删除后不可恢复，确定删除这笔账单吗？",
      success: async (modal) => {
        if (!modal.confirm) { self.setData({ slidBillId: "" }); return; }
        try {
          await wx.cloud.callFunction({ name: "accountingFunctions", data: { action: "deleteBill", familyId: app.globalData.currentFamilyId, billId, version: bill.version } });
          self.setData({ slidBillId: "" });
          app.globalData.billsDirty = true;
          app.globalData.homeSummaryDirty = true;
          wx.showToast({ title: "已删除", icon: "success" });
          self.setData({ offset: 0 });
          await self.loadBills(false, true);
        } catch (error) { wx.showToast({ title: error.message || "删除失败", icon: "none" }); self.setData({ slidBillId: "" }); }
      }
    });
  },

  closeDelete() { this.setData({ slidBillId: "" }); }
});
