import React from 'react'
import { useState } from 'react'
import './Chatbot.css'
import { Form, useFetcher } from '@remix-run/react'

type Props = {}

const Chatbot = (props: Props) => {
  const [isOpen, setIsOpen ] = useState(false)
  const toggleChatbox = ( ) => setIsOpen(!isOpen)

  const fetcher = useFetcher()

  const handleSubmit = async()=>{
    try {
      fetcher.submit({},{
        method: 'POST',
        encType:'multipart/form-data',
        action:'/api/chat'
      })
    } catch (error) {
      
    }
  }
  return (
    <div className='chat-container'>
      <button className='chat-toggle' onClick={toggleChatbox}>
        {isOpen ? 'x' : 'open'}
      </button>
      {isOpen && (
      <Form onSubmit={handleSubmit}>
       <div className='chat-box'>
       <div className="chat-header">
         <h4>Chat wih us</h4>
         <button className="close-chat">x</button>
       </div>
       <div className="chat-body"></div>
       <div className="chat-footer">
        <input type="text" className="chat-input" placeholder='Type your message...'/>
        <button className='send-button'>Send</button>
       </div>
       </div>
      </Form>
      )}
    </div>
  )
}

export default Chatbot