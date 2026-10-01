/**
 * Prompt picker popover — the modal the composer accessory opens.
 *
 * The popover is a single React tree:
 *  - a search box (filters by title/body/tags/description),
 *  - the filtered prompt list (click → expand the variable form),
 *  - the variable input form (one row per detected variable),
 *  - the preview pane showing the rendered body,
 *  - the Insert button.
 *
 * Selection state lives in the popover — it does NOT pollute the
 * PromptsStore. The popover receives the store snapshot through
 * `useSnapshot` and forwards inserts to the host via the
 * `onInsert(renderedText)` callback supplied by the parent (the parent is
 * the composer accessory, which routes inserts through `inputActions.setDraft`).
 *
 * Opening/closing is owned by the parent; this component only handles the
 * "Insert" / "Cancel" lifecycle of one open session. The mask is the
 * catchable click surface outside the panel; Escape and the close button
 * are the keyboard paths.
 */

import { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Button, IconSearchOutline16, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { collectVariables, interpolate } from '../schema.ts'
import type { PromptListItem } from './store.ts'
import type { Translator } from './PromptEditor.tsx'
import { identityTranslator } from './PromptEditor.tsx'
import styles from './PromptPickerPopover.module.css'

/** Injected dependencies of {@link PromptPickerPopover}. */
export interface PromptPickerPopoverInjected {
  /** Filtered, sorted list of prompts ready for rendering. */
  items: readonly PromptListItem[]
  /** Section copy. */
  t: Translator
}

/** Props delivered by the slot outlet. */
export type PromptPickerPopoverProps = Partial<InjectFace<PromptPickerPopoverInjected> & PropsLocale<'prompts'>> & {
  /** Close the popover (Escape, mask click, Cancel button). */
  onClose: () => void
  /** Insert the rendered body into the composer. */
  onInsert: (text: string) => void
}

/**
 * Open the picker popover as a centered overlay; the parent supplies the
 * items list (already filtered and sorted by `PromptsStore.filtered`) so
 * the popover stays focused on selection + variable expansion.
 * @param props - popover props.
 * @returns the React tree.
 */
export function PromptPickerPopover(props: PromptPickerPopoverProps) {
  const t = (props.t ?? identityTranslator) as Translator
  const items = props.items ?? []
  const { onClose, onInsert } = props
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [variableValues, setVariableValues] = useState<Record<string, string>>({})

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length === 0) return items
    return items.filter(item =>
      item.record.title.toLowerCase().includes(q)
      || item.record.body.toLowerCase().includes(q)
      || item.record.description.toLowerCase().includes(q)
      || item.record.tags.some(tag => tag.toLowerCase().includes(q)),
    )
  }, [items, query])

  const selected = useMemo(
    () => items.find(item => item.id === selectedId) ?? null,
    [items, selectedId],
  )

  // Reset selection state when the popover closes/reopens.
  useEffect(() => {
    setQuery('')
    setSelectedId(null)
    setVariableValues({})
  }, [])

  // Escape closes the popover.
  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [onClose])

  const variables = selected !== null ? collectVariables(selected.record.body) : []
  const canInsert = selected !== null
    && selected.record.body.trim().length > 0
    && variables.every(name => (variableValues[name] ?? '').trim().length > 0)
  const preview = selected !== null
    ? interpolate(selected.record.body, variableValues)
    : ''

  return (
    <div className={styles.root} role="dialog" aria-modal="true" aria-label={t('pickerTitle')}>
      <div className={styles.mask} aria-hidden="true" onClick={onClose} />
      <div className={styles.panel}>
        <header className={styles.header}>
          <h2 className={styles.title}>{t('pickerTitle')}</h2>
          <Button variant="ghost" size="sm" icon={<span aria-hidden>×</span>} aria-label={t('pickerClose')} onClick={onClose} />
        </header>
        <div className={styles.searchRow}>
          <Input
            icon={<IconSearchOutline16 />}
            value={query}
            placeholder={t('pickerSearch')}
            onChange={(event: ChangeEvent<HTMLInputElement>) => { setQuery(event.target.value) }}
            autoFocus
          />
        </div>
        {selected === null
          ? (
            <ul className={styles.list}>
              {filteredItems.length === 0
                ? <li className={styles.empty}>{t('pickerEmpty')}</li>
                : filteredItems.map(item => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={styles.listButton}
                      onClick={() => { setSelectedId(item.id) }}
                    >
                      <span className={styles.listTitle}>{item.record.title}</span>
                      <span className={styles.listId}>{item.id}</span>
                      {item.variables.length > 0 && (
                        <span className={styles.listVariables}>
                          {item.variables.map(name => `{{${name}}}`).join(' ')}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
            </ul>
          )
          : (
            <div className={styles.detail}>
              <button
                type="button"
                className={styles.back}
                onClick={() => { setSelectedId(null) }}
              >
                ← {t('cancel')}
              </button>
              <div className={styles.detailHeader}>
                <div className={styles.detailTitle}>{selected.record.title}</div>
                <div className={styles.detailId}>{selected.id}</div>
              </div>
              {selected.record.description.length > 0 && (
                <p className={styles.detailDescription}>{selected.record.description}</p>
              )}
              {selected.record.body.trim().length === 0 && (
                <p className={styles.empty}>{t('pickerNoBody')}</p>
              )}
              {variables.length > 0 && (
                <div className={styles.variablesSection}>
                  <div className={styles.variablesLabel}>{t('pickerVariables')}</div>
                  <ul className={styles.variableList}>
                    {variables.map(name => (
                      <li key={name} className={styles.variableRow}>
                        <label className={styles.variableName}>{`{{${name}}}`}</label>
                        <Input
                          value={variableValues[name] ?? ''}
                          placeholder={name}
                          onChange={(event: ChangeEvent<HTMLInputElement>) => {
                            setVariableValues(prev => ({ ...prev, [name]: event.target.value }))
                          }}
                        />
                      </li>
                    ))}
                  </ul>
                  {variables.some(name => (variableValues[name] ?? '').trim().length === 0) && (
                    <p className={styles.hint}>{t('pickerVariableMissing')}</p>
                  )}
                </div>
              )}
              <div className={styles.previewSection}>
                <div className={styles.previewLabel}>{t('preview')}</div>
                <pre className={styles.preview}>{preview}</pre>
              </div>
              <div className={styles.actions}>
                <Button variant="ghost" onClick={onClose}>{t('cancel')}</Button>
                <Button
                  variant="primary"
                  disabled={!canInsert}
                  onClick={() => {
                    if (!canInsert) return
                    onInsert(preview)
                  }}
                >
                  {t('pickerInsert')}
                </Button>
              </div>
            </div>
          )}
      </div>
    </div>
  )
}
