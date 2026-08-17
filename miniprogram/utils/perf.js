// 性能工具：debounce / throttle。
// 页面 onLoad 中创建实例并保存到 this，多次复用同一实例。

const debounce = (fn, delay = 200) => {
  let timer = null;
  const debounced = function (...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn.apply(this, args);
    }, delay);
  };
  debounced.cancel = () => {
    if (timer) { clearTimeout(timer); timer = null; }
  };
  return debounced;
};

const throttle = (fn, interval = 200) => {
  let lastCall = 0;
  let pendingTimer = null;
  const throttled = function (...args) {
    const now = Date.now();
    const remaining = interval - (now - lastCall);
    if (remaining <= 0) {
      if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
      lastCall = now;
      fn.apply(this, args);
    } else if (!pendingTimer) {
      pendingTimer = setTimeout(() => {
        lastCall = Date.now();
        pendingTimer = null;
        fn.apply(this, args);
      }, remaining);
    }
  };
  throttled.cancel = () => {
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
  };
  return throttled;
};

module.exports = { debounce, throttle };
