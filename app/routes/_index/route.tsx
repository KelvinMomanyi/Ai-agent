import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>AOVBoost</h1>
        <p className={styles.text}>
             Your AI Sales Agent for Smart Cross-Sells
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
            <li>
              <strong>Smart product recommendations</strong>. Show relevant cross-sell and upsell products based on what customers are browsing or adding to cart.
            </li>
            <li>
              <strong>Automatic placement on product and cart pages</strong>. Instantly display offers without editing your theme or configuring placement manually.
            </li>
            <li>
              <strong>Real-time AOV tracking</strong>. Monitor how much extra revenue each cross-sell recommendation is generating.
            </li>
            <li>
              <strong>Works seamlessly with your existing Shopify theme</strong>. No coding needed and fully responsive on desktop and mobile.
            </li>
          </ul>

        </ul>
      </div>
    </div>
  );
}
