/**
 * Who operates this deployment. Shown on the Privacy and Terms pages, so set these in
 * the environment (Vercel project settings) before inviting users.
 */
export const COMPANY_NAME: string = import.meta.env.VITE_COMPANY_NAME || "Kaasu";
export const CONTACT_EMAIL: string | undefined = import.meta.env.VITE_CONTACT_EMAIL || undefined;
export const PRODUCT_TAGLINE = "Your salary, spending and investments in one place.";
