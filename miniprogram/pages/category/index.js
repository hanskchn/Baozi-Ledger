Page({
  data: {
    type: "expense",
    categories: []
  },

  onShow() {
    // TODO: 加载分类列表
  },

  switchType(e) {
    this.setData({ type: e.currentTarget.dataset.type });
    // TODO: 重新加载
  },

  addCategory1() {
    // TODO: 新增一级分类
  },

  addCategory2(e) {
    // TODO: 新增二级分类
  },

  editCategory(e) {
    // TODO: 编辑分类
  },

  deleteCategory(e) {
    // TODO: 删除分类
  }
});
