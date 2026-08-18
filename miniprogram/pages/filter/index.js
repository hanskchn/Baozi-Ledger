const app = getApp();

Page({
  data: {
    // 时间
    filterMonth: '',
    filterDateStart: '',
    filterDateEnd: '',
    timeDisplay: '全部时间',
    timeMode: 'all', // all | month | range
    quick: 'thisMonth', // thisMonth | lastMonth | thisYear | all | custom
    tempMonth: '',
    tempDateStart: '',
    tempDateEnd: '',
    showTimeSheet: false,
    // 分类
    filterCategory: '',
    filterCategoryType: '',
    filterCategoryLevel: '',
    categoryDisplay: '全部',
    categories: [],
    visibleCategoryGroups: [],
    showCategorySheet: false,
    // 账户
    filterAccount: '',
    accountDisplay: '全部',
    accounts: [],
    accountOptions: ['全部'],
    accountIndex: 0,
    // 流水类型
    filterType: '',
    typeDisplay: '全部',
    typeOptions: ['全部', '支出', '收入'],
    typeValues: ['', 'expense', 'income'],
    typeIndex: 0,
    // 成员
    filterMember: '',
    filterMemberLabel: '',
    memberDisplay: '全部',
    members: [],
    memberOptions: ['全部'],
    memberValues: [''],
    memberIndex: 0,
    // 商家
    merchant: '',
    // 金额
    minAmount: '',
    maxAmount: '',
    // 备注
    remark: ''
  },

  onLoad(options) {
    this._initFromOptions(options || {});
    this._loadOptions();
  },

  _initFromOptions(options) {
    const decode = (v) => (v ? decodeURIComponent(v) : '');
    const filterMonth = decode(options.filterMonth);
    const filterDateStart = decode(options.filterDateStart);
    const filterDateEnd = decode(options.filterDateEnd);
    const filterType = decode(options.filterType);
    const patch = {
      filterMonth,
      filterDateStart,
      filterDateEnd,
      filterType,
      filterCategory: decode(options.filterCategory),
      filterCategoryLevel: decode(options.filterCategoryLevel),
      filterAccount: decode(options.filterAccount),
      filterMember: decode(options.filterMember),
      filterMemberLabel: decode(options.filterMemberLabel),
      merchant: decode(options.merchant),
      minAmount: decode(options.minAmount),
      maxAmount: decode(options.maxAmount),
      remark: decode(options.remark)
    };

    const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const thisMonth = now.getUTCFullYear() + '-' + String(now.getUTCMonth() + 1).padStart(2, '0');
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const lastMonth = prev.getUTCFullYear() + '-' + String(prev.getUTCMonth() + 1).padStart(2, '0');

    if (filterDateStart || filterDateEnd) {
      patch.timeMode = 'range';
      patch.quick = 'custom';
      patch.tempDateStart = filterDateStart;
      patch.tempDateEnd = filterDateEnd;
      patch.timeDisplay = (filterDateStart || '') + ' ~ ' + (filterDateEnd || '');
    } else if (filterMonth) {
      patch.timeMode = 'month';
      patch.tempMonth = filterMonth;
      if (filterMonth === thisMonth) { patch.quick = 'thisMonth'; patch.timeDisplay = '本月'; }
      else if (filterMonth === lastMonth) { patch.quick = 'lastMonth'; patch.timeDisplay = '上月'; }
      else {
        patch.quick = 'custom';
        const [y, m] = filterMonth.split('-');
        patch.timeDisplay = y + '年' + Number(m) + '月';
      }
    } else {
      patch.timeMode = 'all';
      patch.quick = 'all';
      patch.tempMonth = thisMonth;
      patch.timeDisplay = '全部时间';
    }
    if (filterType) {
      patch.typeIndex = filterType === 'income' ? 2 : 1;
      patch.typeDisplay = filterType === 'income' ? '收入' : '支出';
    }
    if (patch.filterCategory) patch.categoryDisplay = patch.filterCategory;
    if (patch.filterAccount) patch.accountDisplay = patch.filterAccount;
    if (patch.filterMemberLabel) patch.memberDisplay = patch.filterMemberLabel;
    else if (patch.filterMember) patch.memberDisplay = '已选成员';
    this.setData(patch);
  },

  async _loadOptions() {
    const familyId = app.globalData.currentFamilyId;
    if (!familyId) return;
    try {
      const res = await wx.cloud.callFunction({
        name: 'accountingFunctions',
        data: { action: 'listFormOptions', familyId }
      });
      const categories = res.result?.categories || [];
      const members = res.result?.members || [];
      const accounts = res.result?.accounts || [];
      const accountOptions = ["全部"].concat(accounts.map((item) => item.name));
      const memberOptions = ["全部"].concat(members.map((item) => item.nickName || "微信用户"));
      const memberValues = [""].concat(members.map((item) => item.memberId));
      const patch = {
        categories, members, accounts,
        accountOptions, memberOptions, memberValues
      };
      const accIdx = accountOptions.indexOf(this.data.filterAccount);
      if (accIdx > 0) patch.accountIndex = accIdx;
      const memIdx = memberValues.indexOf(this.data.filterMember);
      if (memIdx > 0) {
        patch.memberIndex = memIdx;
        patch.memberDisplay = memberOptions[memIdx];
        patch.filterMemberLabel = memberOptions[memIdx];
      }
      patch.visibleCategoryGroups = this._buildCategoryGroups(categories, this.data.filterType);
      this.setData(patch);
    } catch (e) {
      console.error('筛选页加载选项失败', e);
    }
  },

  // ========== 时间弹层 ==========
  openTimeSheet() {
    this.setData({ showTimeSheet: true });
  },
  closeTimeSheet() {
    this.setData({ showTimeSheet: false });
  },
  stopPropagation() {},

  selectQuick(e) {
    const key = e.currentTarget.dataset.key;
    const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const thisMonth = now.getUTCFullYear() + '-' + String(now.getUTCMonth() + 1).padStart(2, '0');
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const lastMonth = prev.getUTCFullYear() + '-' + String(prev.getUTCMonth() + 1).padStart(2, '0');
    const thisYearStart = now.getUTCFullYear() + '-01-01';
    const thisYearEnd = now.getUTCFullYear() + '-12-31';
    const today = now.getUTCFullYear() + '-' + String(now.getUTCMonth() + 1).padStart(2, '0') + '-' + String(now.getUTCDate()).padStart(2, '0');
    const patch = { quick: key };
    if (key === 'thisMonth') {
      patch.timeMode = 'month';
      patch.filterMonth = thisMonth;
      patch.filterDateStart = '';
      patch.filterDateEnd = '';
      patch.tempMonth = thisMonth;
      patch.timeDisplay = '本月';
    } else if (key === 'lastMonth') {
      patch.timeMode = 'month';
      patch.filterMonth = lastMonth;
      patch.filterDateStart = '';
      patch.filterDateEnd = '';
      patch.tempMonth = lastMonth;
      patch.timeDisplay = '上月';
    } else if (key === 'thisYear') {
      patch.timeMode = 'range';
      patch.filterMonth = '';
      patch.filterDateStart = thisYearStart;
      patch.filterDateEnd = thisYearEnd;
      patch.tempDateStart = thisYearStart;
      patch.tempDateEnd = thisYearEnd;
      patch.timeDisplay = '今年';
    } else if (key === 'all') {
      patch.timeMode = 'all';
      patch.filterMonth = '';
      patch.filterDateStart = '';
      patch.filterDateEnd = '';
      patch.timeDisplay = '全部时间';
    } else if (key === 'customMonth') {
      patch.quick = '';
      patch.timeMode = 'month';
      if (!this.data.tempMonth) patch.tempMonth = thisMonth;
      this.setData(patch);
      return;
    } else if (key === 'customRange') {
      patch.quick = '';
      patch.timeMode = 'range';
      if (!this.data.tempDateStart) patch.tempDateStart = thisMonth + '-01';
      if (!this.data.tempDateEnd) patch.tempDateEnd = today;
      this.setData(patch);
      return;
    }
    this.setData(patch);
  },

  onTempMonthChange(e) {
    const value = e.detail.value;
    const [y, m] = value.split('-');
    this.setData({
      tempMonth: value,
      quick: '',
      timeMode: 'month',
      filterMonth: value,
      filterDateStart: '',
      filterDateEnd: '',
      timeDisplay: y + '年' + Number(m) + '月'
    });
  },

  onTempStartChange(e) { this.setData({ tempDateStart: e.detail.value, quick: '' }); },
  onTempEndChange(e) { this.setData({ tempDateEnd: e.detail.value, quick: '' }); },

  confirmTimeSheet() {
    if (this.data.timeMode === 'range') {
      const start = this.data.tempDateStart;
      const end = this.data.tempDateEnd;
      if (!start || !end) { wx.showToast({ title: '请选择完整日期', icon: 'none' }); return; }
      if (start > end) { wx.showToast({ title: '开始日期不能晚于结束日期', icon: 'none' }); return; }
      this.setData({
        filterMonth: '',
        filterDateStart: start,
        filterDateEnd: end,
        timeDisplay: start + ' ~ ' + end,
        quick: 'custom',
        showTimeSheet: false
      });
    } else if (this.data.timeMode === 'month') {
      const month = this.data.tempMonth;
      if (!month) { wx.showToast({ title: '请选择月份', icon: 'none' }); return; }
      const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
      const thisMonth = now.getUTCFullYear() + '-' + String(now.getUTCMonth() + 1).padStart(2, '0');
      const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      const lastMonth = prev.getUTCFullYear() + '-' + String(prev.getUTCMonth() + 1).padStart(2, '0');
      const [y, m] = month.split('-');
      this.setData({
        filterMonth: month,
        filterDateStart: '',
        filterDateEnd: '',
        quick: month === thisMonth ? 'thisMonth' : (month === lastMonth ? 'lastMonth' : 'custom'),
        timeDisplay: month === thisMonth ? '本月' : (month === lastMonth ? '上月' : (y + '年' + Number(m) + '月')),
        showTimeSheet: false
      });
    } else {
      this.setData({
        filterMonth: '', filterDateStart: '', filterDateEnd: '',
        quick: 'all', timeDisplay: '全部时间', showTimeSheet: false
      });
    }
  },

  // ========== 分类 ==========
  _buildCategoryGroups(categories, filterType, selectedName, selectedLevel) {
    const activeName = selectedName !== undefined ? selectedName : this.data.filterCategory;
    const activeLevel = selectedLevel !== undefined ? selectedLevel : this.data.filterCategoryLevel;
    const groups = [];
    (categories || []).forEach((parent) => {
      if (filterType && parent.type !== filterType) return;
      const parentActive = activeName === parent.name && activeLevel === 'category1';
      const children = (parent.children || []).map((child) => ({
        name: child.name,
        icon: child.icon || '📝',
        type: parent.type,
        label: parent.name + ' · ' + child.name,
        active: activeName === child.name && activeLevel === 'category2'
      }));
      if (children.length) {
        groups.push({
          name: parent.name,
          icon: parent.icon || '📂',
          type: parent.type,
          typeLabel: parent.type === 'income' ? '收入' : '支出',
          active: parentActive,
          children
        });
      }
    });
    return groups;
  },

  openCategorySheet() {
    this.setData({
      showCategorySheet: true,
      visibleCategoryGroups: this._buildCategoryGroups(this.data.categories, this.data.filterType)
    });
  },
  closeCategorySheet() { this.setData({ showCategorySheet: false }); },

  selectCategory(e) {
    const name = e.currentTarget.dataset.name || '';
    const type = e.currentTarget.dataset.type || '';
    if (!name) {
      this.setData({
        filterCategory: '',
        filterCategoryType: '',
        filterCategoryLevel: '',
        categoryDisplay: '全部',
        visibleCategoryGroups: this._buildCategoryGroups(this.data.categories, this.data.filterType, '', ''),
        showCategorySheet: false
      });
      return;
    }
    const level = e.currentTarget.dataset.level || 'category2';
    const patch = {
      filterCategory: name,
      filterCategoryType: type,
      filterCategoryLevel: level,
      categoryDisplay: name,
      showCategorySheet: false
    };
    if (type) {
      patch.filterType = type;
      patch.typeIndex = type === 'income' ? 2 : 1;
      patch.typeDisplay = type === 'income' ? '收入' : '支出';
    }
    patch.visibleCategoryGroups = this._buildCategoryGroups(this.data.categories, patch.filterType || this.data.filterType, name, level);
    this.setData(patch);
  },

  // ========== 账户 ==========
  onAccountChange(event) {
    const index = Number(event.detail.value);
    this.setData({
      accountIndex: index,
      filterAccount: index === 0 ? '' : this.data.accountOptions[index],
      accountDisplay: index === 0 ? '全部' : this.data.accountOptions[index]
    });
  },

  // ========== 流水类型 ==========
  onTypeChange(event) {
    const index = Number(event.detail.value);
    const filterType = this.data.typeValues[index];
    const patch = {
      typeIndex: index,
      filterType,
      typeDisplay: this.data.typeOptions[index]
    };
    if (this.data.filterCategory && this.data.filterCategoryType && this.data.filterCategoryType !== filterType) {
      patch.filterCategory = '';
      patch.filterCategoryType = '';
      patch.filterCategoryLevel = '';
      patch.categoryDisplay = '全部';
    }
    patch.visibleCategoryGroups = this._buildCategoryGroups(
      this.data.categories,
      filterType,
      patch.filterCategory !== undefined ? patch.filterCategory : this.data.filterCategory,
      patch.filterCategoryLevel !== undefined ? patch.filterCategoryLevel : this.data.filterCategoryLevel
    );
    this.setData(patch);
  },

  // ========== 成员 ==========
  onMemberChange(event) {
    const index = Number(event.detail.value);
    const label = index === 0 ? '全部' : this.data.memberOptions[index];
    this.setData({
      memberIndex: index,
      filterMember: this.data.memberValues[index],
      filterMemberLabel: label,
      memberDisplay: label
    });
  },

  // ========== 商家 ==========
  onMerchantInput(e) { this.setData({ merchant: (e.detail.value || '').trim() }); },

  // ========== 金额 ==========
  onMinAmountInput(e) { this.setData({ minAmount: e.detail.value }); },
  onMinAmountBlur(e) { this._validateAmount('minAmount', e.detail.value); },
  onMaxAmountInput(e) { this.setData({ maxAmount: e.detail.value }); },
  onMaxAmountBlur(e) { this._validateAmount('maxAmount', e.detail.value); },
  _validateAmount(field, raw) {
    const v = (raw || '').trim();
    if (v && !/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(v)) {
      wx.showToast({ title: '请输入有效金额', icon: 'none' });
      this.setData({ [field]: '' });
    } else {
      this.setData({ [field]: v });
    }
  },

  // ========== 备注 ==========
  onRemarkInput(e) { this.setData({ remark: (e.detail.value || '').slice(0, 50) }); },

  // ========== 重置 ==========
  onReset() {
    const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const thisMonth = now.getUTCFullYear() + '-' + String(now.getUTCMonth() + 1).padStart(2, '0');
    this.setData({
      filterMonth: thisMonth,
      filterDateStart: '',
      filterDateEnd: '',
      timeMode: 'month',
      quick: 'thisMonth',
      tempMonth: thisMonth,
      timeDisplay: '本月',
      filterCategory: '',
      filterCategoryType: '',
      filterCategoryLevel: '',
      categoryDisplay: '全部',
      filterAccount: '',
      accountDisplay: '全部',
      accountIndex: 0,
      filterType: '',
      typeDisplay: '全部',
      typeIndex: 0,
      filterMember: '',
      filterMemberLabel: '',
      memberDisplay: '全部',
      memberIndex: 0,
      merchant: '',
      minAmount: '',
      maxAmount: '',
      remark: '',
      visibleCategoryGroups: this._buildCategoryGroups(this.data.categories, '', '', '')
    });
  },

  // ========== 确定 ==========
  onConfirm() {
    const min = parseFloat(this.data.minAmount);
    const max = parseFloat(this.data.maxAmount);
    if (!isNaN(min) && !isNaN(max) && min > max) {
      wx.showToast({ title: '最低金额不能大于最高金额', icon: 'none' });
      return;
    }
    const pages = getCurrentPages();
    const prevPage = pages[pages.length - 2];
    if (prevPage) prevPage.onFilterConfirm(this._buildResult());
    wx.navigateBack();
  },

  _buildResult() {
    const result = {};
    if (this.data.filterDateStart || this.data.filterDateEnd) {
      result.filterDateStart = this.data.filterDateStart;
      result.filterDateEnd = this.data.filterDateEnd;
      result.filterMonth = '';
    } else {
      result.filterMonth = this.data.filterMonth;
      result.filterDateStart = '';
      result.filterDateEnd = '';
    }
    result.filterCategory = this.data.filterCategory;
    result.filterCategoryLevel = this.data.filterCategoryLevel;
    result.filterAccount = this.data.filterAccount;
    result.filterType = this.data.filterType;
    result.filterMember = this.data.filterMember;
    result.filterMemberLabel = this.data.filterMemberLabel;
    result.merchant = this.data.merchant;
    result.minAmount = this.data.minAmount;
    result.maxAmount = this.data.maxAmount;
    result.remark = this.data.remark;
    return result;
  }
});
