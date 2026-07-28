# findInPage 与 Playwright 的已知限制

Playwright(CDP 调试器)附加时,Electron 38 的 `webContents.findInPage` 不派发
`found-in-page` 事件;脱离 Playwright 直接运行则完全正常。

验证记录(2026-07-28,electron 38.8.6,win32-x64):

- 独立最小 main(无 CDP):`findInPage('content')` → 立即收到
  `{"matches":2,"activeMatchOrdinal":1,"finalUpdate":true}` ✓
- 同一二进制经 Playwright 启动:干净 BrowserWindow + data: 页面,同样调用,3s 无任何事件 ✗

因此 e2e 中查找计数改为注入合成 `ev:find:result` 事件验证渲染器接线;
真实查找行为(高亮 + 计数)需人工或独立脚本验证。
