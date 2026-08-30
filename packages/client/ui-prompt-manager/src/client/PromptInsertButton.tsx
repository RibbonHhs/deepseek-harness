/**
 * The composer accessory — the small icon button that opens the picker.
 *
 * Renders inside `conversation.input.left`, sitting beside the resident
 * chrome (access mode / plan / attach). Clicking opens the picker
 * popover; selecting a prompt and pressing Insert calls
 * `inputActions.setDraft(renderedText)` to replace the composer draft.
 * The accessory also subscribes to the prompt library snapshot so the
 * picker reflects external edits (e.g. an admin opening the Settings
 * tab while the composer is mounted).
 */

import { useCallback, useState } from 'react'
import { Button, IconListPenOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PromptListItem, PromptsStore, PromptsState } from './store.ts'
import { PromptPickerPopover } from './PromptPickerPopover.tsx'
import { identityTranslator, type Translator } from './PromptEditor.tsx'
import styles from './PromptInsertButton.module.css'

/** Injected dependencies of {@link PromptInsertButton} (slot `inject`). */
export interface PromptInsertButtonInjected {
  /** Bound store backing the picker. */
  controller: PromptsStore
  hooks: {
    /** Store snapshot for filtered-item recomputation. */
    snapshot: PromptsStore['store']
  }
  /** Section copy. */
  t: Translator
}

/**
 * Props delivered by the slot outlet: the inject face spread flat plus
 * the session-scope standard kit (`inputActions`) and the locale binding
 * supplied by the parent slot.
 */
export type PromptInsertButtonProps = Partial<
  PropsRuntime<'conversation.input.left'>
  & InjectFace<PromptInsertButtonInjected>
  & PropsLocale<'prompts'>
>

/**
 * The composer-accessory icon button + picker popover. The button stays
 * inert while the composer is locked (e.g. a subagent takeover is active);
 * the standard-kit's `input.locked` would be the more idiomatic signal,
 * but `inputActions.setDraft` rejects locked drafts on its own, so the
 * guard is implemented at the action call site.
 * @param props - rendered props.
 * @returns the React tree.
 */
export function PromptInsertButton(props: PromptInsertButtonProps) {
  const controller = props.controller
  const t = (props.t ?? identityTranslator) as Translator
  const useSnapshot = props.useSnapshot as unknown as
    (<S>(selector: (s: PromptsState) => S) => S) | undefined
  const [pickerOpen, setPickerOpen] = useState(false)

  const handleInsert = useCallback((text: string) => {
    if (props.inputActions === undefined) {
      // No input machine attached (root-scope composer without a session);
      // closing without writing is the safe default.
      setPickerOpen(false)
      return
    }
    props.inputActions.setDraft(text)
    setPickerOpen(false)
  }, [props.inputActions])

  if (controller === undefined || useSnapshot === undefined) {
    return null
  }

  const state = useSnapshot(snapshot => snapshot)
  const items = controller.filtered(state)

  return (
    <div className={styles.root}>
      <Button
        variant="ghost"
        size="sm"
        icon={<IconListPenOutline16 size={14} />}
        className={styles.promptsChip}
        aria-label={t('buttonLabel')}
        aria-haspopup="dialog"
        aria-expanded={pickerOpen}
        title={t('buttonLabelHint')}
        onClick={() => { setPickerOpen(true) }}
      >
        {t('buttonLabel')}
      </Button>
      {pickerOpen && (
        <PromptPickerPopover
          items={items as readonly PromptListItem[]}
          t={t}
          onClose={() => { setPickerOpen(false) }}
          onInsert={handleInsert}
        />
      )}
    </div>
  )
}
