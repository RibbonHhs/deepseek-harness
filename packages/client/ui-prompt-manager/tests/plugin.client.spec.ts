// @vitest-environment jsdom
/**
 * Plugin-level smoke: both halves mount, the section + composer accessory
 * register into the right slots, and the host half is a no-op apply.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply as applyHost } from '../src'
import { apply, inject } from '../src/client'
import { PromptsSection } from '../src/client/PromptsSection.tsx'
import { PromptInsertButton } from '../src/client/PromptInsertButton.tsx'

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  // Declare both target slots at the root so the plugin's slot.inject can run.
  ctx.slots.register({
    name: 'root',
    children: {
      'settings.section': { kind: 'list', scope: 'root' },
      'conversation.input.right': { kind: 'list', scope: 'session' },
    },
  } as never, () => null)
  // Provide noop stubs for the services `inject` requires. The plugin never
  // calls into them at apply time; we just need the fibers to settle.
  const stub = { locale: { register: () => undefined, bind: () => (key: string) => key }, settingsScope: { bind: () => ({ getSnapshot: () => ({ status: 'unavailable', value: undefined, base: undefined, user: undefined, revision: undefined, writable: false, mode: 'memory' }), subscribe: () => () => undefined, set: () => Promise.resolve(), unset: () => Promise.resolve() }) }, connection: { isLoopback: true, api: {} }, slots: ctx.slots } as never
  const fiber = ctx.plugin({ inject: [...inject], apply })
  // Wire the stub services before the plugin body runs.
  Object.assign(ctx, stub)
  await fiber.await()
  return { ctx, fiber }
}

describe('prompt-manager plugin', () => {
  it('keeps the host half empty', () => {
    // The host apply only registers a settings namespace; pass a stub ctx
    // carrying a no-op settings provider so the call does not throw.
    const stub = { settings: { register: () => undefined } } as never
    expect(() => { applyHost(stub) }).not.toThrow()
  })

  it('registers the settings.section and composer accessory entries and removes them with the plugin fiber', async () => {
    const { ctx, fiber } = await bench()
    expect(inject).toContain('slots')
    const sections = ctx.slots.entries('settings.section')
    const prompts = sections.filter(entry => (entry.options as { id?: string }).id === 'prompts')
    expect(prompts).toHaveLength(1)
    expect((prompts[0] as { component: unknown }).component).toBe(PromptsSection)

    const rights = ctx.slots.entries('conversation.input.right')
    const button = rights.filter(entry => (entry.options as { id?: string }).id === 'prompts')
    expect(button).toHaveLength(1)
    expect((button[0] as { component: unknown }).component).toBe(PromptInsertButton)

    await fiber.dispose()

    expect(ctx.slots.entries('settings.section')
      .filter(e => (e.options as { id?: string }).id === 'prompts')).toHaveLength(0)
    expect(ctx.slots.entries('conversation.input.right')
      .filter(e => (e.options as { id?: string }).id === 'prompts')).toHaveLength(0)
  })
})
