---
kind: upgrade-guide
description: "WebFetchBody 新增 pdf 分支；application/pdf 抓取现在解码为提取文本。"
---

# Web 抓取 PDF 分支

[English](guide.md) | 中文

## 变更

`WebFetchBody` 新增 `{ kind: 'pdf', content }`。`dsh-web-fetch-http` 提供方现在把 `application/pdf` 响应归类为可解码：通过 pdf.js 提取页面文本，保留页序，并沿用与文本正文相同的字节与字符限界。无法解析的 PDF 正文以 `WEB_PROVIDER_ERROR` 失败。封闭联合意味着每个对 `kind` 做 `switch` 的消费方都必须处理新分支，否则在 `assertNever` 处编译失败。

## 迁移

1. 重新构建对 `WebFetchBody.kind` 做 switch 的消费方；TypeScript 会标出每个未处理的 `pdf` 分支。提取文本按 `text` 正文渲染——它不含标记。
2. 依赖 `application/pdf` 抛出 `WEB_UNSUPPORTED_CONTENT_TYPE` 的部署，现在应预期返回 `kind: 'pdf'` 的成功抓取；如需门控请包装提供方或过滤结果，而不是按内容类型判断。
3. `dsh-web-fetch-http` 新增 `pdfjs-dist` 运行时依赖；私有镜像的包集合必须同步镜像它。
