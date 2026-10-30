/** Real retained guest exercising the built Browser read-only design helpers. */
import { app, BrowserWindow } from 'electron'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const [guestModule, nativeModule, userData] = process.argv.slice(2)
app.setPath('userData', userData)
const server = createServer((_request, response) => {
  response.setHeader('content-type', 'text/html')
  response.end('<!doctype html><body><button id=actual style="position:absolute;left:12px;top:20px;width:120px;height:40px">Actual guest</button></body>')
})
let owner
async function run() {
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  await app.whenReady()
  const { DesktopBrowserGuests } = await import(pathToFileURL(guestModule).href)
  owner = new BrowserWindow({ show: false, width: 900, height: 700, webPreferences: {
    sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: true,
  } })
  const manager = new DesktopBrowserGuests(() => undefined)
  manager.bind(owner, () => () => {})
  await owner.loadURL('data:text/html,<div id=page></div>')
  const reservation = manager.acquire(owner.webContents, 'browser-design-fixture')
  const native = (await readFile(nativeModule, 'utf8')).replaceAll('export ', '')
  const origin = `http://127.0.0.1:${server.address().port}`
  const result = await owner.webContents.executeJavaScript(`(async () => {
    ${native}
    const host = document.getElementById('page');
    const guest = document.createElement('webview');
    guest.dataset.sidebarBrowserFrame = 'webview';
    guest.setAttribute('name', ${JSON.stringify(reservation.lease)});
    guest.setAttribute('partition', ${JSON.stringify(reservation.partition)});
    guest.src = ${JSON.stringify('about:blank#' + reservation.lease)};
    const ready = new Promise(resolve => guest.addEventListener('dom-ready', resolve, {once:true}));
    host.append(guest); await ready;
    await guest.loadURL(${JSON.stringify(origin + '/page')});
    const id = guest.getWebContentsId();
    const sizes = [];
    for (const [width,height] of [[1440,850],[768,1024],[390,844]]) {
      guest.style.cssText = 'display:flex;width:'+width+'px;height:'+height+'px;transform:scale(0.5);transform-origin:top left';
      await new Promise(resolve => setTimeout(resolve, 150));
      const size = await guest.executeJavaScript('[innerWidth,innerHeight]');
      if (size[0] !== width || size[1] !== height || guest.getWebContentsId() !== id) throw Error('Guest viewport or identity changed');
      sizes.push(size);
    }
    const html = await readNativeHTML('page');
    if (!html?.includes('Actual guest')) throw Error('Missing native HTML');
    const bounds = guest.getBoundingClientRect();
    const element = await inspectNativeElement('page', bounds.left+20, bounds.top+20);
    if (element?.selector !== '#actual' || element.pageUrl !== ${JSON.stringify(origin + '/page')}
      || element.rect.width !== 120 || element.rect.height !== 40) throw Error('Invalid native inspection: '+JSON.stringify(element));
    const located = await locateNativeElement('page', element);
    if (!located || Math.abs(located.x-(bounds.left+6)) > 1 || Math.abs(located.y-(bounds.top+10)) > 1) throw Error('Invalid native marker location');
    await guest.executeJavaScript("document.getElementById('actual').textContent='Replaced action'");
    if (await locateNativeElement('page', element) !== null) throw Error('Stale marker was retained');
    return {sizes,element:true,html:true,sameGuest:true,marker:true};
  })()`)
  console.log('BROWSER_DESIGN_RESULT ' + JSON.stringify(result))
  await manager.release(owner.webContents, reservation.lease)
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  owner?.destroy()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  app.quit()
}
}
void run()
