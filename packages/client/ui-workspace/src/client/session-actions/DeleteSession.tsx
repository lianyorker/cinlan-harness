/**
 * The delete confirmation dialog: the `shell.overlay` entry that answers a
 * pending delete request. The request is raised from the Settings archived-
 * sessions page (the only surface that lists archived Sessions); the dialog
 * lives in the frame-wide overlay so it outlives any row that raised it.
 * Deletion is permanent, so it confirms first.
 */
import { useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  SessionDeleteDialogInjected, SessionDeleteDialogProps, SessionDeleteTarget,
} from '../contract/slots.ts'
import css from '../rows/WorkspaceBrowser.module.css'

/**
 * The `shell.overlay` entry: nothing while no deletion is requested,
 * otherwise one dialog per request (keyed by the Session). Confirming asks
 * the Host to remove the archived Session's durable log permanently;
 * cancelling leaves everything as it was.
 * @param props - the request hook, its settlement, the delete hop, and the locale seat.
 * @returns the open dialog, or null.
 */
export function SessionDeleteDialog({ useDeleteRequest, settleSessionDelete, deleteSession, t }: SessionDeleteDialogProps) {
  const request = useDeleteRequest(pending => pending)
  if (request === null) return null
  return (
    <DeleteConfirmForm
      key={request.sessionId}
      request={request}
      deleteSession={deleteSession}
      onSettle={settleSessionDelete}
      t={t}
    />
  )
}

/** One request's dialog: in-flight and error state die with it. */
function DeleteConfirmForm({ request, deleteSession, onSettle, t }: {
  request: SessionDeleteTarget
  deleteSession: SessionDeleteDialogInjected['deleteSession']
  onSettle: () => void
  t: SessionDeleteDialogProps['t']
}) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const close = () => {
    if (deleting) return
    onSettle()
  }
  const confirm = () => {
    if (deleting) return
    setDeleting(true)
    setError(null)
    deleteSession(request.sessionId).then(() => {
      setDeleting(false)
      onSettle()
    }).catch((reason: unknown) => {
      setDeleting(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }
  return (
    <Modal
      open
      onClose={close}
      closeLabel={t('close')}
      title={t('delete.session.title')}
      description={t('delete.session.desc', { title: request.displayTitle })}
      footer={(
        <>
          <Button variant="outline" disabled={deleting} onClick={close}>{t('cancel')}</Button>
          <Button variant="primary" disabled={deleting} onClick={confirm}>{t('delete.session.action')}</Button>
        </>
      )}
    >
      {deleting && <div className={css.renameError} role="status">{t('delete.session.pending')}</div>}
      {error !== null && <div className={css.renameError} role="alert">{error}</div>}
    </Modal>
  )
}
