import { describe, expect, it } from 'vitest'
import { splitStructuredOutput } from '@/components/llm-console/LLMStageStreamCard'

describe('LLMStageStreamCard structured output parsing', () => {
  it('moves think-tagged text from final block into reasoning', () => {
    const parsed = splitStructuredOutput(`【Reasoning】
已有思考

【Final Result】
<think>追加思考</think>
{"locations":[]}`)

    expect(parsed.reasoning).toContain('已有思考')
    expect(parsed.reasoning).toContain('追加思考')
    expect(parsed.finalText).toBe('{"locations":[]}')
  })

  it('handles unmatched think opening tag during streaming', () => {
    const parsed = splitStructuredOutput(`【Final Result】
<think>流式中的思考还没结束`)

    expect(parsed.reasoning).toBe('流式中的思考还没结束')
    expect(parsed.finalText).toBe('')
  })
})
