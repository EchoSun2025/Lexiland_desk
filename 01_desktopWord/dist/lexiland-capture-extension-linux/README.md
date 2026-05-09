# Lexiland Chrome Extension MVP

这是当前版本的 Lexiland 方案：一个完全离线、只依赖 Chrome 本地能力的 extension。

## 当前范围

已实现：

- 双击网页英文词语自动捕获
- 自动提取句子上下文
- 保存 `word / sentenceContext / pageTitle / pageUrl / createdAt`
- `chrome.storage.local` 本地存储
- Side Panel 浏览、搜索、展开、删除
- 按 `Today / Yesterday / Earlier` 分组
- 导出 JSON

明确不做：

- 翻译
- AI API
- 中文释义
- 登录和云同步
- WordDrop
- PDF / YouTube / Teams

## 加载方式

1. 打开 `chrome://extensions/`
2. 开启右上角 `Developer mode`
3. 点击 `Load unpacked`
4. 选择当前目录：

```text
01_desktopWord
```

## 使用方式

1. 打开任意英文网页
2. 双击一个英文单词
3. 页面右上角会短暂提示 `Saved` 或 `Already saved`
4. 点击扩展图标或等待自动打开 side panel
5. 在 side panel 中搜索、展开详情、打开来源页、删除、导出 JSON

## 数据格式

每条记录格式：

```json
{
  "id": "uuid",
  "word": "context",
  "sentenceContext": "Context helps you remember how a word is actually used.",
  "pageTitle": "MDN Web Docs",
  "pageUrl": "https://developer.mozilla.org/example-page",
  "source": "chrome_double_click",
  "createdAt": "2026-05-09T10:12:00+12:00"
}
```

导出文件名格式：

```text
lexiland-captured-words-YYYY-MM-DD.json
```

## 本地校验

可运行：

```powershell
npm run check
```
