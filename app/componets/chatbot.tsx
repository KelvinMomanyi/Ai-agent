// app/components/ChatBot.tsx
import { useState } from "react";
import {
  Page,
  Button,
  Layout,
  Text,
} from '@shopify/polaris';

export default function ChatBot() {
    const [messages, setMessages] = useState<Array<{ from: string; text: any }>>([]);
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
            <div style={{ marginTop: '8px' }}>
              <Button onClick={sendMessage} disabled={loading}>
                {loading ? 'Thinking...' : 'Suggest an Upsell'}
              </Button>
            </div>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }
