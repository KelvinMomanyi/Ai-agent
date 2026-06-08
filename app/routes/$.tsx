import type { LoaderFunctionArgs } from "@remix-run/node";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return new Response(null, { status: 404 });
};

export const action = async ({ request }: LoaderFunctionArgs) => {
  return new Response(null, { status: 404 });
};
