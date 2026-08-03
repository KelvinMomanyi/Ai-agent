import type { LoaderFunctionArgs } from "react-router";

export const loader = async ({ request: _request }: LoaderFunctionArgs) => {
  return new Response(null, { status: 404 });
};

export const action = async ({ request: _request }: LoaderFunctionArgs) => {
  return new Response(null, { status: 404 });
};
