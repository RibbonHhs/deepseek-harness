/**
 * MCP server editor — modal dialog used by both create and update flows.
 *
 * The editor is a controlled component: the parent owns the candidate id
 * and record and supplies a save callback. Validation lives in the store;
 * the editor surfaces field-level errors per the validator's `error`
 * field. Switching transports collapses the irrelevant fields. The
 * editor is also where the kebab-case id pattern is enforced — the id is
 * editable on create and immutable on update.
 */

import { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { McpServerRecord } from '../schema.ts'
import { MCP_SERVER_ID_PATTERN } from '../schema.ts'
import type { McpServersStore } from './store.ts'
import { identityTranslator, type Translator } from './translator.ts'
import styles from './McpServerEditor.module.css'

/** Field name of a validation failure surfaced inline. */
type FieldError = 'id' | 'name' | 'command' | 'url' | null

export interface McpServerEditorProps {
  /** Section copy. */
  t: Translator
  /** The store actions entry point. */
  controller: McpServersStore
  /** Whether the dialog is open. */
  open: boolean
  /** Closing callback (Cancel button, Escape, mask click). */
  onClose: () => void
  /** Pre-filled storage id; '' for create mode. */
  initialId: string
  /** Pre-filled record; undefined for create mode. */
  initialRecord?: McpServerRecord
}

/**
 * Parse a "one per line" string into an array of trimmed, non-empty entries.
 * Empty lines and pure-whitespace lines are skipped silently.
 */
function parseList(value: string): string[] {
  return value.split('\n').map(part => part.trim()).filter(part => part.length > 0)
}

/**
 * Parse a "KEY=value" / "Name: Value" string into an object. Lines without a
 * separator (or with empty value) are skipped. Duplicates: the last value
 * wins. Returns undefined when no lines parse, otherwise a record.
 */
function parseMap(value: string, separator: '=' | ':'): Record<string, string> | undefined {
  const result: Record<string, string> = {}
  let any = false
  for (const raw of value.split('\n')) {
    const line = raw.trim()
    if (line.length === 0) continue
    const idx = line.indexOf(separator)
    if (idx <= 0 || idx === line.length - 1) continue
    const key = line.slice(0, idx).trim()
    const val = line.slice(idx + 1).trim()
    if (key.length === 0 || val.length === 0) continue
    result[key] = val
    any = true
  }
  return any ? result : undefined
}

/**
 * Serialize a record into "KEY=value" lines for the env / headers editors.
 */
function stringifyMap(record: Record<string, string> | undefined, separator: '=' | ':'): string {
  if (record === undefined) return ''
  return Object.entries(record).map(([k, v]) => `${k}${separator}${v}`).join('\n')
}

/**
 * Render the MCP server editor dialog. Submit invokes either
 * `store.create` or `store.update` depending on whether the initial id
 * is empty.
 * @param props - editor props.
 * @returns the React tree.
 */
export function McpServerEditor(props: McpServerEditorProps) {
  const t = (props.t ?? identityTranslator) as Translator
  const { open, onClose, initialId, initialRecord, controller } = props
  const isUpdate = initialId.length > 0

  // Local form state. The store stays untouched while the user types; we
  // commit on save. Resetting to initial values happens when `open` flips.
  const [id, setId] = useState(initialId)
  const [name, setName] = useState(initialRecord?.name ?? '')
  const [description, setDescription] = useState(initialRecord?.description ?? '')
  const [transport, setTransport] = useState<McpServerRecord['transport']>(initialRecord?.transport ?? 'stdio')
  const [command, setCommand] = useState(initialRecord?.command ?? '')
  const [argsText, setArgsText] = useState((initialRecord?.args ?? []).join('\n'))
  const [envText, setEnvText] = useState(stringifyMap(initialRecord?.env, '='))
  const [url, setUrl] = useState(initialRecord?.url ?? '')
  const [headersText, setHeadersText] = useState(stringifyMap(initialRecord?.headers, ':'))
  const [enabled, setEnabled] = useState(initialRecord?.enabled ?? true)
  const [fieldError, setFieldError] = useState<FieldError>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setId(initialId)
    setName(initialRecord?.name ?? '')
    setDescription(initialRecord?.description ?? '')
    setTransport(initialRecord?.transport ?? 'stdio')
    setCommand(initialRecord?.command ?? '')
    setArgsText((initialRecord?.args ?? []).join('\n'))
    setEnvText(stringifyMap(initialRecord?.env, '='))
    setUrl(initialRecord?.url ?? '')
    setHeadersText(stringifyMap(initialRecord?.headers, ':'))
    setEnabled(initialRecord?.enabled ?? true)
    setFieldError(null)
    setBusy(false)
  }, [open, initialId, initialRecord])

  const idInvalid = id.length > 0 && !MCP_SERVER_ID_PATTERN.test(id.trim())
  const idTaken = useMemo(
    () => !isUpdate && id.trim().length > 0 && controller.findById(id.trim()) !== undefined,
    [controller, id, isUpdate],
  )

  async function handleSave(): Promise<void> {
    setBusy(true)
    setFieldError(null)
    const trimmedId = id.trim()
    if (!MCP_SERVER_ID_PATTERN.test(trimmedId)) {
      setFieldError('id')
      setBusy(false)
      return
    }
    if (name.trim().length === 0) {
      setFieldError('name')
      setBusy(false)
      return
    }
    // Under exactOptionalPropertyTypes we can't assign `undefined` to an
    // optional field; spread conditionally so unset fields stay absent.
    // `parseMap` may return undefined for empty inputs — coalesce to {}
    // because the record field is optional but, when present, must be a
    // record (not undefined).
    //
    // The `status` block is activator-written; we keep the previous value
    // across edits so the UI doesn't flash "pending" mid-save while the
    // activator re-evaluates. The activator will overwrite status on the
    // next reconcile pass once the new config takes effect.
    const previousStatus = initialRecord?.status
    const record: McpServerRecord = {
      id: trimmedId,
      name: name.trim(),
      transport,
      enabled,
      args: parseList(argsText),
      env: parseMap(envText, '=') ?? {},
      headers: parseMap(headersText, ':') ?? {},
      ...(description.trim().length > 0 ? { description: description.trim() } : {}),
      ...(command.trim().length > 0 ? { command: command.trim() } : {}),
      ...(previousStatus !== undefined ? { status: previousStatus } : {}),
      ...(url.trim().length > 0 ? { url: url.trim() } : {}),
    }
    if (record.transport === 'stdio' && record.command === undefined) {
      setFieldError('command')
      setBusy(false)
      return
    }
    if (record.transport === 'streamable-http' && record.url === undefined) {
      setFieldError('url')
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
      title={isUpdate ? t('editServer', { title: initialRecord?.name ?? '' }) : t('newServer')}
      closeLabel={t('cancel')}
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
          <label className={styles.editorLabel}>{t('fieldName')}</label>
          <Input
            value={name}
            placeholder={t('fieldNamePlaceholder')}
            onChange={(event: ChangeEvent<HTMLInputElement>) => { setName(event.target.value) }}
            aria-invalid={fieldError === 'name'}
          />
          {fieldError === 'name' && (
            <span className={styles.editorError}>{t('nameRequired')}</span>
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
          {!isUpdate && idTaken && fieldError !== 'id' && !idInvalid && (
            <span className={styles.editorError}>{t('fieldIdDuplicate')}</span>
          )}
        </div>

        <div className={styles.editorField}>
          <label className={styles.editorLabel}>{t('fieldTransport')}</label>
          <div className={styles.transportTabs}>
            <button
              type="button"
              className={transport === 'stdio' ? styles.transportTabActive : styles.transportTab}
              onClick={() => { setTransport('stdio') }}
              aria-pressed={transport === 'stdio'}
            >
              {t('transportStdio')}
            </button>
            <button
              type="button"
              className={transport === 'streamable-http' ? styles.transportTabActive : styles.transportTab}
              onClick={() => { setTransport('streamable-http') }}
              aria-pressed={transport === 'streamable-http'}
            >
              {t('transportHttp')}
            </button>
          </div>
        </div>

        {transport === 'stdio' ? (
          <>
            <div className={styles.editorField}>
              <label className={styles.editorLabel}>{t('fieldCommand')}</label>
              <Input
                value={command}
                placeholder={t('fieldCommandPlaceholder')}
                onChange={(event: ChangeEvent<HTMLInputElement>) => { setCommand(event.target.value) }}
                aria-invalid={fieldError === 'command'}
              />
              {fieldError === 'command' && (
                <span className={styles.editorError}>{t('commandRequired')}</span>
              )}
            </div>
            <div className={styles.editorField}>
              <label className={styles.editorLabel}>{t('fieldArgs')}</label>
              <textarea
                className={styles.editorTextarea}
                value={argsText}
                placeholder={t('fieldArgsPlaceholder')}
                rows={3}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) => { setArgsText(event.target.value) }}
              />
            </div>
            <div className={styles.editorField}>
              <label className={styles.editorLabel}>{t('fieldEnv')}</label>
              <textarea
                className={styles.editorTextarea}
                value={envText}
                placeholder={t('fieldEnvPlaceholder')}
                rows={3}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) => { setEnvText(event.target.value) }}
              />
            </div>
          </>
        ) : (
          <>
            <div className={styles.editorField}>
              <label className={styles.editorLabel}>{t('fieldUrl')}</label>
              <Input
                value={url}
                placeholder={t('fieldUrlPlaceholder')}
                onChange={(event: ChangeEvent<HTMLInputElement>) => { setUrl(event.target.value) }}
                aria-invalid={fieldError === 'url'}
              />
              {fieldError === 'url' && (
                <span className={styles.editorError}>{t('urlRequired')}</span>
              )}
            </div>
            <div className={styles.editorField}>
              <label className={styles.editorLabel}>{t('fieldHeaders')}</label>
              <textarea
                className={styles.editorTextarea}
                value={headersText}
                placeholder={t('fieldHeadersPlaceholder')}
                rows={3}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) => { setHeadersText(event.target.value) }}
              />
            </div>
          </>
        )}

        <div className={styles.editorField}>
          <label className={styles.editorLabel}>{t('fieldDescription')}</label>
          <Input
            value={description}
            placeholder={t('fieldDescriptionPlaceholder')}
            onChange={(event: ChangeEvent<HTMLInputElement>) => { setDescription(event.target.value) }}
          />
        </div>

        <div className={styles.editorField}>
          <label className={styles.enabledToggle}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => { setEnabled(event.target.checked) }}
            />
            <span>{t('fieldEnabled')}</span>
          </label>
          <span className={styles.editorHint}>{t('enabledHint')}</span>
        </div>
      </div>
    </Modal>
  )
}
