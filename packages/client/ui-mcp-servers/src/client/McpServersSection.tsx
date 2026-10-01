/**
 * MCP servers settings section — the CRUD surface for the MCP registry.
 *
 * Renders a search box, the list of registered servers, and a "New server"
 * button. Each row exposes inline enable/disable, edit, and delete
 * actions; the editor dialog (`McpServerEditor`) handles create/update,
 * while a small inline confirmation handles delete. The page reads its
 * snapshot through `useSnapshot` (bound by the UI renderer from the
 * `hooks.snapshot` source) and writes through the store's actions. The
 * store funnels writes through `scope.set/unset` so the host activator
 * sees the change via `ctx.settings.subscribe` and reconnects/disposes
 * accordingly.
 */

import { useEffect, useState } from 'react'
import {
  Button, IconEditOutline16, IconPlusOutline16, IconSearchOutline16,
  IconTrashOutline16, Input, Modal, Pill,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { McpServersStore, McpServersState, McpServerListItem } from './store.ts'
import type { McpServerRecord, McpServerStatus, McpServerState } from '../schema.ts'
import { McpServerEditor } from './McpServerEditor.tsx'
import { identityTranslator, type Translator } from './translator.ts'
import styles from './McpServersSection.module.css'

/** Injected dependencies of {@link McpServersSection} (slot `inject`). */
export interface McpServersSectionInjected {
  /** The page store (loaded on mount, refreshed on pushed invalidations). */
  controller: McpServersStore
  hooks: {
    /** Page snapshot bound by the UI renderer as useSnapshot. */
    snapshot: McpServersStore['store']
  }
  /** Section copy. */
  t: Translator
}

/** Props delivered by the slot outlet: the inject face spread flat. */
export type McpServersSectionProps = Partial<InjectFace<McpServersSectionInjected>>

/**
 * The MCP servers page: search, list, edit modal, and create button.
 * Each row's enable toggle writes back through the store so the activator
 * picks up the change on the next reconcile pass.
 * @param props - rendered props.
 * @returns the React tree.
 */

/**
 * One row's lifecycle badge. Disabled records always read "Disabled"
 * regardless of `status` (the activator torn the fiber down).
 * `failed` carries the activator's error message as a `title` tooltip
 * so the user can hover to see what went wrong.
 */
function StatusBadge({ record, t }: { record: McpServerRecord; t: Translator }) {
  if (!record.enabled) {
    return (
      <span className={`${styles.statusBadge} ${styles.statusBadgeDisabled}`}>
        <span className={styles.statusDot} />
        {t('statusDisabled')}
      </span>
    )
  }
  const status: McpServerStatus | undefined = record.status
  const state: McpServerState | 'unknown' = status?.state ?? 'unknown'
  const className = (() => {
    switch (state) {
      case 'connected': return `${styles.statusBadge} ${styles.statusBadgeConnected}`
      case 'pending': return `${styles.statusBadge} ${styles.statusBadgePending}`
      case 'failed': return `${styles.statusBadge} ${styles.statusBadgeFailed}`
      case 'disabled': return `${styles.statusBadge} ${styles.statusBadgeConnected}`
      case 'unknown': return `${styles.statusBadge} ${styles.statusBadgeUnknown}`
    }
  })()
  const label = (() => {
    switch (state) {
      case 'connected': return t('statusConnected')
      case 'pending': return t('statusPending')
      case 'failed': return t('statusFailed')
      case 'disabled': return t('statusConnected')
      case 'unknown': return t('statusUnknown')
    }
  })()
  const title = state === 'failed' && status?.error !== undefined && status.error.length > 0
    ? t('statusFailedTooltip', { error: status.error })
    : undefined
  return (
    <span className={className} {...(title !== undefined ? { title } : {})}>
      <span className={styles.statusDot} />
      {label}
    </span>
  )
}

export function McpServersSection(props: McpServersSectionProps) {
  const controller = props.controller
  const t = (props.t ?? identityTranslator) as Translator
  const useSnapshot = props.useSnapshot as unknown as
    (<S>(selector: (s: McpServersState) => S) => S) | undefined

  if (controller === undefined || useSnapshot === undefined) {
    return (
      <div className={styles.section}>
        <p className={styles.error}>{t('loadFailed')}</p>
      </div>
    )
  }

  const state = useSnapshot(snapshot => snapshot)

  // Editor dialog state. `''` initialId means "create mode".
  const [editing, setEditing] = useState<
    { id: string; record: McpServerRecord | undefined } | null
  >(null)
  const [confirmDelete, setConfirmDelete] = useState<McpServerListItem | null>(null)

  useEffect(() => { void controller.load() }, [controller])

  const filtered = controller.filtered(state)

  if (!state.writable && state.status === 'ready') {
    return (
      <div className={styles.section}>
        <header className={styles.header}>
          <h2 className={styles.title}>{t('title')}</h2>
          <p className={styles.intro}>{t('intro')}</p>
        </header>
        <p className={styles.readOnly}>{t('readOnly')}</p>
      </div>
    )
  }

  return (
    <div className={styles.section}>
      <header className={styles.header}>
        <h2 className={styles.title}>{t('title')}</h2>
        <p className={styles.intro}>{t('intro')}</p>
      </header>

      <div className={styles.controls}>
        <div className={styles.search}>
          <Input
            icon={<IconSearchOutline16 />}
            value={state.query}
            placeholder={t('search')}
            onChange={(event) => { controller.setQuery(event.target.value) }}
          />
        </div>
        <Button
          variant="primary"
          icon={<IconPlusOutline16 />}
          onClick={() => { setEditing({ id: '', record: undefined }) }}
        >
          {t('newServer')}
        </Button>
      </div>

      {state.status === 'ready' && filtered.length === 0 && (
        <p className={styles.empty}>
          {Object.keys(state.section).length === 0
            ? t('empty')
            : t('noMatches')}
        </p>
      )}

      <ul className={styles.list}>
        {filtered.map(item => (
          <li key={item.id} className={styles.row}>
            <div className={styles.rowMain}>
              <div className={styles.rowTitle}>{item.record.name}</div>
              <div className={styles.rowId}>{item.id}</div>
              <div className={styles.rowMeta}>
                <Pill active={true}>
                  {item.record.transport === 'stdio' ? t('transportStdio') : t('transportHttp')}
                </Pill>
                <span className={styles.rowSummary}>
                  {summarizeTransport(item.record)}
                </span>
                <StatusBadge record={item.record} t={t} />
              </div>
              {item.record.description !== undefined && item.record.description.length > 0 && (
                <div className={styles.rowDescription}>{item.record.description}</div>
              )}
            </div>
            <div className={styles.rowActions}>
              <label className={styles.enabledToggle}>
                <input
                  type="checkbox"
                  checked={item.record.enabled}
                  onChange={(event) => {
                    void controller.setEnabled(item.id, event.target.checked)
                  }}
                  aria-label={t('fieldEnabled')}
                />
                <span className={styles.enabledLabel}>
                  {item.record.enabled ? t('enabledOn') : t('enabledOff')}
                </span>
              </label>
              <Button
                variant="ghost"
                size="sm"
                icon={<IconEditOutline16 />}
                aria-label={t('editServer', { title: item.record.name })}
                onClick={() => { setEditing({ id: item.id, record: item.record }) }}
              />
              <Button
                variant="ghost"
                size="sm"
                icon={<IconTrashOutline16 />}
                aria-label={t('deleteServer', { title: item.record.name })}
                onClick={() => { setConfirmDelete(item) }}
              />
            </div>
          </li>
        ))}
      </ul>

      {editing !== null && (
        <McpServerEditor
          t={t}
          controller={controller}
          open
          onClose={() => { setEditing(null) }}
          initialId={editing.id}
          {...(editing.record === undefined ? {} : { initialRecord: editing.record })}
        />
      )}

      {confirmDelete !== null && (
        <DeleteConfirmDialog
          item={confirmDelete}
          controller={controller}
          t={t}
          onClose={() => { setConfirmDelete(null) }}
        />
      )}
    </div>
  )
}

/** One-line summary of the transport-specific payload for the row. */
function summarizeTransport(record: McpServerRecord): string {
  if (record.transport === 'stdio') {
    const args = record.args ?? []
    return [record.command ?? '', ...args].filter(part => part.length > 0).join(' ')
  }
  return record.url ?? ''
}

/**
 * Inline deletion confirmation dialog. Uses the shared Modal atom for
 * consistent chrome; the body is one short paragraph plus a Cancel/Delete
 * pair. Deletion runs through the store so the activator picks up the
 * change on the next reconcile pass.
 */
function DeleteConfirmDialog(props: {
  item: McpServerListItem
  controller: McpServersStore
  t: Translator
  onClose: () => void
}) {
  const { item, controller, t, onClose } = props
  const [busy, setBusy] = useState(false)
  return (
    <Modal
      open
      onClose={onClose}
      title={t('deleteTitle')}
      closeLabel={t('cancel')}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>{t('cancel')}</Button>
          <Button
            variant="primary"
            onClick={() => {
              setBusy(true)
              void controller.remove(item.id).then(() => { onClose() })
            }}
            disabled={busy}
          >
            {busy ? t('saving') : t('confirmDelete')}
          </Button>
        </>
      )}
    >
      <p className={styles.deleteDescription}>{t('deleteDescription')}</p>
      <div className={styles.deleteIdentity}>
        <span className={styles.deleteTitle}>{item.record.name}</span>
        <span className={styles.deleteId}>{item.id}</span>
      </div>
    </Modal>
  )
}
