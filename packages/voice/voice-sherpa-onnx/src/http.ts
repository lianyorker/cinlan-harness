/** Legacy loopback HTTP adapter over the same validated operations used by Remote. */
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import type { VoiceRuntime } from '@deepseek-ai/dsh-voice'
import { parseVoiceModelRequest, parseVoiceTranscribeRequest } from '@deepseek-ai/dsh-voice/transport'
import { isTrustedVoiceApiRequest } from './trust-fence.ts'
import { readJsonBody, VoiceApiError, writeError, writeJson, writeOk } from './wire.ts'

/**
 * Register the loopback-only HTTP route for an available webserver.
 * @param webServer - Optional transport supplied by the enclosing injection scope.
 * @param voice - Shared provider-neutral operations facade.
 * @returns Disposer withdrawing the route.
 */
export function mountHttpAdapter(webServer: WebServer, voice: VoiceRuntime): () => void {
  return webServer.register({
    kind: 'prefix', path: '/voice/api',
    handler: async (req, res) => {
      if (!isTrustedVoiceApiRequest(req.headers)) {
        writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
        return
      }
      if (req.method !== 'POST') {
        writeJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
        return
      }
      const controller = new AbortController()
      const abort = (): void => { controller.abort(new DOMException('voice HTTP request closed', 'AbortError')) }
      const onClose = (): void => { if (!res.writableEnded) abort() }
      req.once('aborted', abort)
      res.once('close', onClose)
      const { signal } = controller
      try {
        const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
        const method = pathname.slice('/voice/api/'.length)
        const payload = await readJsonBody(req)
        signal.throwIfAborted()
        switch (method) {
          case 'engine.status': writeOk(res, await voice.engineStatus(signal)); return
          case 'models.list': writeOk(res, await voice.modelsList(signal)); return
          case 'models.download': writeOk(res, await voice.modelsDownload(parseVoiceModelRequest(payload), signal)); return
          case 'models.remove':
            await voice.modelsRemove(parseVoiceModelRequest(payload), signal)
            writeOk(res, {})
            return
          case 'transcribe': writeOk(res, await voice.transcribe(parseVoiceTranscribeRequest(payload), signal)); return
          default: throw new VoiceApiError('not-found', 'unknown voice API method "' + method + '"', 404)
        }
      } catch (error) {
        if (!res.destroyed) writeError(res, error)
      } finally {
        req.off('aborted', abort)
        res.off('close', onClose)
      }
    },
  })
}
