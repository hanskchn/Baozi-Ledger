Page({
  data: {
    keyword: "",
    results: []
  },

  onInput(e) {
    this.setData({ keyword: e.detail.value });
    // TODO: 防抖搜索
  },

  onSearch() {
    // TODO: 调用搜索
  },

  onItemTap(e) {
    // TODO: 跳转编辑
  }
});
