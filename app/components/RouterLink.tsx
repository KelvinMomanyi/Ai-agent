import { forwardRef, type ComponentProps } from "react";
import type { AppProvider } from "@shopify/polaris";
import { Link } from "react-router";

/** Keep Polaris navigation inside the authenticated React Router data flow. */
type Props = ComponentProps<
  NonNullable<ComponentProps<typeof AppProvider>["linkComponent"]>
>;
export const RouterLink = forwardRef<HTMLAnchorElement, Props>(
  function RouterLink({ url, external, children, ...props }, ref) {
    if (external || !url.startsWith("/") || url.startsWith("//")) {
      return (
        <a {...props} href={url} ref={ref}>
          {children}
        </a>
      );
    }
    return (
      <Link {...props} to={url} ref={ref}>
        {children}
      </Link>
    );
  },
);
