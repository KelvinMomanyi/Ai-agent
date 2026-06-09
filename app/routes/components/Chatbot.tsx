import { useState, useRef, useEffect, useCallback } from 'react'
import './Chatbot.css'

type Message = { role: 'user' | 'assistant'; content: string }

const Chatbot = () => {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: 'Hi. Can I help you find the perfect product today?' },
  ])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const messagesRef = useRef(messages)
  messagesRef.current = messages

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    }
  }, [messages])

  const handleSubmit = useCallback(async (event: React.FormEvent) => {
    event.preventDefault()
    const text = inputRef.current?.value.trim()
    if (!text || loading) return
    if (inputRef.current) inputRef.current.value = ''

    const currentMessages = messagesRef.current
    const assistantIdx = currentMessages.length + 1

    setMessages(prev => [...prev, { role: 'user', content: text }, { role: 'assistant', content: '' }])
    setLoading(true)

    try {
      const sdk = (window as any).AOVBoostSDK
      const config = (window as any).AOVBoost || {}
      const apiBase = (config.apiBase || '/apps/aovboost').replace(/\/$/, '')
      const response = await fetch(`${apiBase}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AOVBoost-Shop': sdk?.shop || config.shop || '',
        },
        body: JSON.stringify({
          sessionId: sdk?.sessionId,
          sessionToken: sdk?.sessionToken,
          shop: sdk?.shop || config.shop,
          message: text,
          messageHistory: currentMessages,
        }),
      })

      if (!response.ok || !response.body) {
        setMessages(prev => {
          const next = [...prev]
          next[assistantIdx] = { role: 'assistant', content: 'I had trouble connecting. Please try again in a moment.' }
          return next
        })
        setLoading(false)
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6)
          if (data === '[DONE]') continue
          try {
            const parsed = JSON.parse(data)
            if (parsed.delta) {
              setMessages(prev => {
                const next = [...prev]
                next[assistantIdx] = { role: 'assistant', content: (next[assistantIdx]?.content || '') + parsed.delta }
                return next
              })
            }
          } catch { /* skip malformed chunks */ }
        }
      }
    } catch {
      setMessages(prev => {
        const next = [...prev]
        next[assistantIdx] = { role: 'assistant', content: 'I had trouble connecting. Please try again in a moment.' }
        return next
      })
    } finally {
      setLoading(false)
    }
  }, [loading])

  return (
    <div className='chat-container'>
      <button className='chat-toggle' onClick={() => setIsOpen(!isOpen)}>
        {isOpen ? 'x' : 'open'}
      </button>
      {isOpen && (
        <div className='chat-box'>
          <div className="chat-header">
            <h4>Chat with us</h4>
            <button type="button" className="close-chat" onClick={() => setIsOpen(false)}>x</button>
          </div>
          <div className="chat-body" ref={bodyRef}>
            {messages.map((msg, i) => (
              <div key={i} className={`chat-message ${msg.role}`}>
                {msg.content || (loading && msg.role === 'assistant' && i === messages.length - 1 ? '...' : '')}
              </div>
            ))}
          </div>
          <form className="chat-footer" onSubmit={handleSubmit}>
            <input ref={inputRef} type="text" className="chat-input" placeholder='Type your message...' disabled={loading} />
            <button type="submit" className='send-button' disabled={loading}>Send</button>
          </form>
        </div>
      )}
    </div>
  )
}

export default Chatbot
