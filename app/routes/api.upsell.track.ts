import type { ActionFunction } from "@remix-run/node";
import { json } from "@remix-run/node";

// Simple in-memory store (replace with DB)
let events: any[] = [];

export function getAllEvents() {
  return events;
}

export const action: ActionFunction = async ({ request }) => {
  try {
    const body = await request.json();
    const { event, timestamp, data } = body;

    if (!event) return json({ error: "Missing event" }, { status: 400 });

    events.push({ event, timestamp, data });

    return json({ success: true });
  } catch (err) {
    return json({ error: "Invalid JSON" }, { status: 400 });
  }
};
