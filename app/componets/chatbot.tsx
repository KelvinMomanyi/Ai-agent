// app/components/ChatBot.tsx
import { useState } from "react";
import {
  Card,
  Page,
  TextField,
  Button,
  Layout,
  Text,
  InlineError,
} from '@shopify/polaris';

export default function ChatBot() {
    const [messages, setMessages] = useState([]);
    const [loading, setLoading] = useState(false);
  
    const sendMessage = async () => {
      setLoading(true);
      const cart = await fetch('/cart.js').then((res) => res.json());
  
      const res = await fetch('/api/upsell', {
        method: 'POST',
        body: JSON.stringify({ cartItems: cart.items }),
      });
  
      const data = await res.json();
      setMessages((prev) => [...prev, { from: 'bot', text: data.suggestion }]);
      setLoading(false);
    };
  
    return (
      <Page>
        <Layout>
          <Layout.Section>
          {messages.map((m, i) => (
          <Text key={i} variant="bodyMd" as="p" >
            {m.text}
          </Text>
            ))}
           <Button onClick={sendMessage} disabled={loading} className="mt-2 bg-blue-500 text-white px-3 py-1 rounded">
              {loading ? 'Thinking...' : 'Suggest an Upsell'}
            </Button>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }
  