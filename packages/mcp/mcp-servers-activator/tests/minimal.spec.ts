/**
 * Minimal test to verify function hoisting works in this test setup.
 */
import { describe, it, expect } from 'vitest'

describe('function hoisting', () => {
  it('can reference a function defined later in the same scope', () => {
    expect(helper()).toBe(42)
  })
})

function helper(): number {
  return 42
}
