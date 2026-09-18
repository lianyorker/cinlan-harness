/** Browser element capture Settings namespace dictionaries. */
export const NS = 'browserElementCapture'

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  availability: '选择已有页面并捕获元素，检查预览后附加到发起操作的会话草稿。发送仍由你在会话中确认。',
  pageTitle: '选择浏览器页面',
  selectionTitle: '选择目标元素',
  imageTitle: '生成元素截图',
  nav: '元素捕获',
  title: '浏览器元素捕获',
  description: '从持久浏览器页面选择元素并生成经过二次校验的裁剪截图。',
  stepOne: '刷新页面列表，然后选择需要捕获的页面。',
  stepTwo: '开始选择后，在目标页面点击高亮元素；按 Escape 或取消按钮退出。',
  stepThree: '检查截图预览，再将图片附加到会话草稿。重新捕获需要再次选择元素。',
  safetyTitle: '安全确认',
  safetyBody: '元素捕获只读取当前页面并保存图片附件，不授予点击、导航、脚本执行或文件上传权限。',
  providerFact: '截图前后会核验所选元素与可见区域。发送图片时，请选择支持图像输入的模型。',
  sessionRequired: '请先打开一个会话，再开始元素选择。',
  refresh: '刷新页面',
  pageLabel: '浏览器页面',
  noPages: '没有可用页面。请在浏览器中打开页面，然后刷新。',
  select: '选择并捕获',
  retry: '重新选择并捕获',
  cancel: '取消',
  discard: '放弃预览',
  loading: '正在读取浏览器页面…',
  selecting: '请在目标页面选择元素…',
  capturing: '正在校验并保存截图…',
  cancelled: '操作已取消，草稿未变更。',
  failed: '捕获未完成。请检查浏览器连接或权限，然后重新选择元素。',
  verified: '已校验的元素截图',
  previewAlt: '选中元素的截图预览',
  previewFailed: '图片预览加载失败，请重新捕获。',
  imageDetails: '{width} × {height} 像素 · {bytes} 字节',
  destination: '目标草稿：{session}',
  attach: '附加到会话草稿',
  attached: '已附加到“{session}”的草稿，尚未发送。',
  sessionUnavailable: '发起操作的会话已不可用。请打开会话并重新捕获。',
  draftBusy: '草稿正在提交。请等待提交完成后再次附加。',
  operationFailed: '浏览器操作失败：{detail}',
} as const

/** Key domain of the Browser Element Capture namespace. */
export type BrowserElementCaptureKey = keyof typeof zh

/** English dictionary with the same keys as the Chinese source. */
export const en: Record<BrowserElementCaptureKey, string> = {
  availability: 'Capture an element from an existing page, review the preview, then attach it to the initiating Session draft. Send it from the conversation when ready.',
  pageTitle: 'Choose a browser page',
  selectionTitle: 'Select an element',
  imageTitle: 'Capture the element image',
  nav: 'Element capture',
  title: 'Browser element capture',
  description: 'Select an element from a persistent browser page and create a revalidated cropped screenshot.',
  stepOne: 'Refresh the page list, then choose the page to capture.',
  stepTwo: 'Start selection and click the highlighted element on the target page; Escape or Cancel exits selection.',
  stepThree: 'Review the preview, then attach the image to your Session draft. Capture again to choose a fresh element.',
  safetyTitle: 'Safety confirmation',
  safetyBody: 'Element capture reads the current page and saves an image attachment; it does not grant click, navigation, script, or upload access.',
  providerFact: 'The selected element and its visible bounds are checked before and after capture. Choose a model that supports images when sending the screenshot.',
  sessionRequired: 'Open a Session before starting element selection.',
  refresh: 'Refresh pages',
  pageLabel: 'Browser page',
  noPages: 'No pages are available. Open a page in the browser, then refresh.',
  select: 'Select and capture',
  retry: 'Select again and capture',
  cancel: 'Cancel',
  discard: 'Discard preview',
  loading: 'Reading browser pages…',
  selecting: 'Choose an element on the target page…',
  capturing: 'Verifying and saving the screenshot…',
  cancelled: 'Operation cancelled. The draft is unchanged.',
  failed: 'Capture did not finish. Check the browser connection or permissions, then select an element again.',
  verified: 'Verified element screenshot',
  previewAlt: 'Screenshot preview of the selected element',
  previewFailed: 'The image preview could not load. Capture it again.',
  imageDetails: '{width} × {height} px · {bytes} bytes',
  destination: 'Destination draft: {session}',
  attach: 'Attach to Session draft',
  attached: 'Attached to the “{session}” draft. It has not been sent.',
  sessionUnavailable: 'The initiating Session is unavailable. Open a Session and capture again.',
  draftBusy: 'The draft is being submitted. Wait for submission to finish, then attach again.',
  operationFailed: 'Browser operation failed: {detail}',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Browser element capture Settings copy. */
    browserElementCapture: BrowserElementCaptureKey
  }
}
