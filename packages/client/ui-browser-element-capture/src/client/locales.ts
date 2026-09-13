/** Browser element capture Settings namespace dictionaries. */
export const NS = 'browserElementCapture'

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  nav: '元素捕获',
  title: '浏览器元素捕获',
  description: '从持久浏览器页面选择元素并生成经过二次校验的裁剪截图。',
  stepOne: '先使用 browser_list 获取目标页面的 page_id；Cinlan Provider 需要人工选择元素。',
  stepTwo: '使用 browser_select_element，在目标页面点击高亮元素，取得 selection_id；按 Escape 可取消。',
  stepThree: '使用 browser_capture_element 和 selection_id 生成裁剪图片；每次尝试后都需要重新选择。',
  safetyTitle: '安全确认',
  safetyBody: '元素捕获只读取当前页面并保存图片附件，不授予点击、导航、脚本执行或文件上传权限。',
  providerFact: 'Provider 会在截图前后核验元素身份与可见区域。Cinlan 不支持用 observation ref 捕获；接收图片的模型必须支持图像输入。',
} as const

/** Key domain of the Browser Element Capture namespace. */
export type BrowserElementCaptureKey = keyof typeof zh

/** English dictionary with the same keys as the Chinese source. */
export const en: Record<BrowserElementCaptureKey, string> = {
  nav: 'Element capture',
  title: 'Browser element capture',
  description: 'Select an element from a persistent browser page and create a revalidated cropped screenshot.',
  stepOne: 'Use browser_list to find the target page_id; the Cinlan Provider requires human element selection.',
  stepTwo: 'Use browser_select_element and click the highlighted element on the target page to obtain a selection_id; Escape cancels.',
  stepThree: 'Use browser_capture_element with that selection_id to create the crop; select again after every attempt.',
  safetyTitle: 'Safety confirmation',
  safetyBody: 'Element capture reads the current page and saves an image attachment; it does not grant click, navigation, script, or upload access.',
  providerFact: 'The Provider verifies element identity and visible bounds before and after the screenshot. Cinlan does not capture observation refs; the receiving model must support image input.',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Browser element capture Settings copy. */
    browserElementCapture: BrowserElementCaptureKey
  }
}
