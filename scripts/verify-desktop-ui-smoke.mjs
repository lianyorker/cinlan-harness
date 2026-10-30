/** Read-only smoke against the development renderer; never prints authenticated URLs. */
const pages = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = pages.find(item => item.type === 'page' && !item.url.startsWith('devtools:'))
if (!page) throw new Error('desktop_renderer_unavailable')
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
const result = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('renderer_check_timeout')), 15000)
  socket.onmessage = event => {
    const message = JSON.parse(event.data)
    if (message.id !== 1) return
    clearTimeout(timer)
    resolve(message.result?.result?.value)
  }
  socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { returnByValue: true, expression: `JSON.stringify({ ready: document.readyState, bodyLength: document.body.innerText.length, hasRoot: !!document.querySelector('#root'), title: document.title, fatal: /启动失败|Startup failed/.test(document.body.innerText) })` } }))
})
socket.close()
console.log(result)
