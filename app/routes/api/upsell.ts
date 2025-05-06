// // Example Remix loader/action route
// export const action = async ({ request }) => {
//     const { cartItems } = await request.json();
//     try {
//       const response = await fetch('https://api.openai.com/v1/chat/completions', {
//       method: 'POST',
//       headers: {
//         Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
//         'Content-Type': 'application/json',
//       },
//       body: JSON.stringify({
//         model: 'gpt-4',
//         messages: [
//           {
//             role: 'system',
//             content: 'You are an AI sales agent that suggests upsells to increase average order value.',
//           },
//           {
//             role: 'user',
//             content: `Cart contents: ${JSON.stringify(cartItems)}`,
//           },
//         ],
//       }),
//     });
  
//     const data = await response.json();
//     return new Response(JSON.stringify({ suggestion: data.choices[0].message.content }));
//     } catch (error) {
//       return new Response(error, 'fetching error')
//     }
    
//   };
//import OpenAI from "openai";



import { json } from '@remix-run/node';
import type { ActionFunctionArgs } from "@remix-run/node";


//const client = new OpenAI(process.env.OPENAI_API_KEY);



export const action = async ({ request }: ActionFunctionArgs) => {
  const { cartItems } = await request.json();
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama3-70b-8192', // or 'llama3-8b-8192'
        messages: [
          {
            role: 'system',
            content: 'You are an AI sales agent that suggests upsells to increase average order value.',
          },
          {
            role: 'user',
            content: `Cart contents: ${JSON.stringify(cartItems)}`,
          },
        ],
      }),
    });
    


  //   const response = await client.responses.create({
  //     model: "gpt-4.1",
  //     messages: [
  //             {
  //               role: 'system',
  //               content: 'You are an AI sales agent that suggests upsells to increase average order value.',
  //             },
  //             {
  //               role: 'user',
  //               content: `Cart contents: ${JSON.stringify(cartItems)}`,
  //             },
  //           ],
  // });
     const data = await response.json();
     console.log(data, 'newData')
    return json({ suggestion: data.choices[0].message.content });
  } catch (error) {
    console.error(error);
    return json({ error: 'fetching error' }, { status: 500 });
  }
};

