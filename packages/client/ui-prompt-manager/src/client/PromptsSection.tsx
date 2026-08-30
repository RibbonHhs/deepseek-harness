/**
 * Prompts settings section — the CRUD surface for the prompt library.
 *
 * Renders a search box, optional tag filter pills, the list of prompts, and a
 * new-prompt button. Each list row exposes Edit/Delete actions; the editor
 * dialog (`PromptEditor`) handles the create/update form, while a small
 * inline confirmation handles delete. The page reads its snapshot through
 * `useSnapshot` (bound by the UI renderer from the `hooks.snapshot` source)
 * and writes through the store's actions.
 */

import { useEffect, useState } from 'react'
import {
  Button, IconEditOutline16, IconPlusOutline16,
  IconSearchOutline16, IconTrashOutline16, Input, Modal, Pill,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { PromptsStore, PromptsState, PromptListItem } from './store.ts'
import type { PromptRecord } from '../schema.ts'
import { PromptEditor, identityTranslator, type Translator } from './PromptEditor.tsx'
import styles from './PromptsSection.module.css'

/** Injected dependencies of {@link PromptsSection} (slot `inject`). */
export interface PromptsSectionInjected {
  /** The page store (loaded on mount, refreshed on pushed invalidations). */
  controller: PromptsStore
  hooks: {
    /** Page snapshot bound by the UI renderer as useSnapshot. */
    snapshot: PromptsStore['store']
  }
  /** Section copy. */
  t: Translator
}

/** Props delivered by the slot outlet: the inject face spread flat plus the locale binding. */
export type PromptsSectionProps = Partial<InjectFace<PromptsSectionInjected> & PropsLocale<'prompts'>>

/**
 * The Prompts page: search, tag filter, list, edit modal, and create button.
 * The list view is intentionally compact — full editing happens in the modal —
 * so a long library stays scannable.
 * @param props - rendered props.
 * @returns the React tree.
 */
export function PromptsSection(props: PromptsSectionProps) {
  const controller = props.controller
  const t = (props.t ?? identityTranslator) as Translator
  const useSnapshot = props.useSnapshot as unknown as
    (<S>(selector: (s: PromptsState) => S) => S) | undefined

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
    { id: string; record: PromptRecord | undefined } | null
  >(null)
  const [confirmDelete, setConfirmDelete] = useState<PromptListItem | null>(null)

  useEffect(() => { void controller.load() }, [controller])

  const filtered = controller.filtered(state)
  const tags = controller.tags(state)

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
          {t('newPrompt')}
        </Button>
      </div>

      {tags.length > 0 && (
        <div className={styles.tagRow}>
          <Pill
            active={state.activeTags.length === 0}
            onClick={() => { controller.clearFilters() }}
          >
            {t('tagAll')}
          </Pill>
          {tags.map(tag => (
            <Pill
              key={tag}
              active={state.activeTags.includes(tag)}
              onClick={() => { controller.toggleTag(tag) }}
            >
              {tag}
            </Pill>
          ))}
        </div>
      )}

      {state.status === 'loading' && (
        <p className={styles.loading}>{t('loading')}</p>
      )}

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
              <div className={styles.rowTitle}>{item.record.title}</div>
              <div className={styles.rowId}>{item.id}</div>
              {item.record.description.length > 0 && (
                <div className={styles.rowDescription}>{item.record.description}</div>
              )}
              {item.record.tags.length > 0 && (
                <div className={styles.rowTags}>
                  {item.record.tags.map(tag => (
                    <span key={tag} className={styles.tag}>{tag}</span>
                  ))}
                </div>
              )}
            </div>
            <div className={styles.rowActions}>
              <Button
                variant="ghost"
                size="sm"
                icon={<IconEditOutline16 />}
                aria-label={t('editPrompt', { title: item.record.title })}
                onClick={() => { setEditing({ id: item.id, record: item.record }) }}
              />
              <Button
                variant="ghost"
                size="sm"
                icon={<IconTrashOutline16 />}
                aria-label={t('deletePrompt', { title: item.record.title })}
                onClick={() => { setConfirmDelete(item) }}
              />
            </div>
          </li>
        ))}
      </ul>

      {editing !== null && (
        <PromptEditor
          t={t}
          controller={controller}
          open
          onClose={() => { setEditing(null) }}
          initialId={editing.id}
          {...editing.record === undefined ? {} : { initialRecord: editing.record }}
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

/**
 * Inline deletion confirmation dialog. Uses the shared Modal atom for
 * consistent chrome; the body is one short paragraph plus a Cancel/Delete
 * pair. Deletion runs through the store so file-backed persistence stays
 * in lockstep with the rendered list.
 */
function DeleteConfirmDialog(props: {
  item: PromptListItem
  controller: PromptsStore
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
      closeLabel={t('pickerClose')}
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
        <span className={styles.deleteTitle}>{item.record.title}</span>
        <span className={styles.deleteId}>{item.id}</span>
      </div>
    </Modal>
  )
}
