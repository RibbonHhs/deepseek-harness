/**
 * Prompt editor — modal dialog used by both create and update flows.
 *
 * The editor is a controlled component: the parent owns the candidate id and
 * record and supplies a save callback. Validation lives in the store; the
 * editor surfaces field-level errors and a single "required" message from
 * the store's last action. The detected variables list updates live as the
 * body changes, and the preview pane renders the body with user-supplied
 * variable values.
 */

import { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, LocaleKeysOf } from '@deepseek-ai/dsh-client-ui-slots'
import { collectVariables, interpolate, PROMPT_ID_PATTERN, type PromptRecord } from '../schema.ts'
import type { PromptsStore } from './store.ts'
import styles from './PromptsSection.module.css'

/** Section copy translator. */
export type Translator = (key: LocaleKeysOf<'prompts'>, params?: Record<string, unknown>) => string

/**
 * Identity translator used when the renderer did not bind a real `t`. Keeps
 * the keys visible in place of the missing strings so a missing-injection
 * bug shows up immediately in the UI instead of silently swapping in blanks.
 */
export const identityTranslator: Translator = key => key

/** Injected dependencies of {@link PromptEditor}. */
export interface PromptEditorInjected {
  /** Section copy. */
  t: Translator
}

/** Props delivered by the slot outlet: the inject face spread flat. */
export type PromptEditorProps = Partial<InjectFace<PromptEditorInjected>> & {
  /** Whether the dialog is open. */
  open: boolean
  /** Closing callback (Cancel button, Escape, mask click). */
  onClose: () => void
  /** Pre-filled storage id; '' for create mode. */
  initialId: string
  /** Pre-filled record; undefined for create mode. */
  initialRecord?: PromptRecord
  /** The store actions entry point. */
  controller: PromptsStore
}

/** Field name of a validation failure surfaced inline. */
type FieldError = 'id' | 'title' | 'body' | null

/**
 * Render the prompt editor dialog. Submit invokes either store.create or
 * store.update depending on whether the initial id matches the current id.
 * @param props - editor props.
 * @returns the React tree.
 */
export function PromptEditor(props: PromptEditorProps) {
  const t = (props.t ?? identityTranslator) as Translator
  const { open, onClose, initialId, initialRecord, controller } = props
  const isUpdate = initialId.length > 0

  // Local form state. The store stays untouched while the user types; we
  // commit on save. Resetting to initial values happens when `open` flips.
  const [id, setId] = useState(initialId)
  const [title, setTitle] = useState(initialRecord?.title ?? '')
  const [body, setBody] = useState(initialRecord?.body ?? '')
  const [description, setDescription] = useState(initialRecord?.description ?? '')
  const [tagsText, setTagsText] = useState((initialRecord?.tags ?? []).join(', '))
  const [variableValues, setVariableValues] = useState<Record<string, string>>({})
  const [fieldError, setFieldError] = useState<FieldError>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setId(initialId)
    setTitle(initialRecord?.title ?? '')
    setBody(initialRecord?.body ?? '')
    setDescription(initialRecord?.description ?? '')
    setTagsText((initialRecord?.tags ?? []).join(', '))
    setVariableValues({})
    setFieldError(null)
    setBusy(false)
  }, [open, initialId, initialRecord])

  const variables = useMemo(() => collectVariables(body), [body])
  const preview = useMemo(() => {
    if (variables.length === 0) return body
    return interpolate(body, variableValues)
  }, [body, variables, variableValues])

  const idInvalid = id.length > 0 && !PROMPT_ID_PATTERN.test(id.trim())
  const idTaken = !isUpdate && id.length > 0 && controller.isIdTaken(id.trim())

  async function handleSave(): Promise<void> {
    setBusy(true)
    setFieldError(null)
    const trimmedId = id.trim()
    const tags = tagsText.split(',').map(part => part.trim()).filter(part => part.length > 0)
    const record: PromptRecord = {
      title: title.trim(),
      body,
      description: description.trim(),
      tags,
      createdAt: initialRecord?.createdAt ?? 0,
      updatedAt: initialRecord?.updatedAt ?? 0,
    }
    if (!PROMPT_ID_PATTERN.test(trimmedId)) {
      setFieldError('id')
      setBusy(false)
      return
    }
    if (record.title.length === 0) {
      setFieldError('title')
      setBusy(false)
      return
    }
    if (record.body.trim().length === 0) {
      setFieldError('body')
      setBusy(false)
      return
    }
    try {
      if (isUpdate) {
        await controller.update(trimmedId, record)
      } else {
        await controller.create(trimmedId, record)
      }
      onClose()
    } catch {
      // Store surfaces the error in its snapshot; no further UI required.
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isUpdate ? t('editPrompt', { title: initialRecord?.title ?? '' }) : t('newPrompt')}
      closeLabel={t('pickerClose')}
      {...(styles.editorDialog !== undefined && { className: styles.editorDialog })}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" onClick={() => { void handleSave() }} disabled={busy}>
            {busy ? t('saving') : t('save')}
          </Button>
        </>
      )}
    >
      <div className={styles.editor}>
        <div className={styles.editorField}>
          <label className={styles.editorLabel}>{t('fieldTitle')}</label>
          <Input
            value={title}
            placeholder={t('fieldTitlePlaceholder')}
            onChange={(event: ChangeEvent<HTMLInputElement>) => { setTitle(event.target.value) }}
            aria-invalid={fieldError === 'title'}
          />
          {fieldError === 'title' && (
            <span className={styles.editorError}>{t('titleRequired')}</span>
          )}
        </div>
        <div className={styles.editorField}>
          <label className={styles.editorLabel}>{t('fieldId')}</label>
          <Input
            value={id}
            placeholder={t('fieldIdPlaceholder')}
            disabled={isUpdate}
            onChange={(event: ChangeEvent<HTMLInputElement>) => { setId(event.target.value) }}
            aria-invalid={fieldError === 'id' || idInvalid}
          />
          <span className={styles.editorHint}>
            {isUpdate ? '' : t('fieldIdHint')}
          </span>
          {fieldError === 'id' && (
            <span className={styles.editorError}>{t('fieldIdInvalid')}</span>
          )}
          {!isUpdate && idInvalid && fieldError !== 'id' && (
            <span className={styles.editorError}>{t('fieldIdInvalid')}</span>
          )}
          {!isUpdate && idTaken && (
            <span className={styles.editorError}>{t('fieldIdDuplicate')}</span>
          )}
        </div>
        <div className={styles.editorField}>
          <label className={styles.editorLabel}>{t('fieldBody')}</label>
          <textarea
            className={styles.editorTextarea}
            value={body}
            placeholder={t('fieldBodyPlaceholder')}
            rows={6}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => { setBody(event.target.value) }}
            aria-invalid={fieldError === 'body'}
          />
          {fieldError === 'body' && (
            <span className={styles.editorError}>{t('bodyRequired')}</span>
          )}
        </div>
        <div className={styles.editorField}>
          <label className={styles.editorLabel}>{t('fieldDescription')}</label>
          <Input
            value={description}
            placeholder={t('fieldDescriptionPlaceholder')}
            onChange={(event: ChangeEvent<HTMLInputElement>) => { setDescription(event.target.value) }}
          />
        </div>
        <div className={styles.editorField}>
          <label className={styles.editorLabel}>{t('fieldTags')}</label>
          <Input
            value={tagsText}
            placeholder={t('fieldTagsPlaceholder')}
            onChange={(event: ChangeEvent<HTMLInputElement>) => { setTagsText(event.target.value) }}
          />
        </div>
        <div className={styles.editorSplit}>
          <div className={styles.editorField}>
            <label className={styles.editorLabel}>{t('fieldVariables')}</label>
            {variables.length === 0
              ? <span className={styles.editorHint}>{t('noVariables')}</span>
              : (
                <ul className={styles.editorVariableList}>
                  {variables.map(name => (
                    <li key={name} className={styles.editorVariableRow}>
                      <code className={styles.editorVariableName}>{`{{${name}}}`}</code>
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
              )}
          </div>
          <div className={styles.editorField}>
            <label className={styles.editorLabel}>{t('preview')}</label>
            <pre className={styles.editorPreview}>
              {variables.length === 0 && body.length === 0 ? t('previewEmpty') : preview}
            </pre>
          </div>
        </div>
      </div>
    </Modal>
  )
}
