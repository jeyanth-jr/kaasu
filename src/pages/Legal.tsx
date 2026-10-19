import { Link } from "react-router-dom";
import { COMPANY_NAME, CONTACT_EMAIL } from "../brand";
import { Logo } from "../ui/Logo";

/**
 * Privacy Policy and Terms of Use. These describe how this software actually behaves, but they are
 * a template: the operator must review them with a lawyer and fill in the company details
 * (VITE_COMPANY_NAME, VITE_CONTACT_EMAIL) before inviting users.
 */
const UPDATED = "19 October 2026";

interface Section {
  h: string;
  p: string[];
}

const contact = CONTACT_EMAIL ? `at ${CONTACT_EMAIL}` : "using the contact details on this site";

const PRIVACY: Section[] = [
  {
    h: "Who we are",
    p: [`${COMPANY_NAME} ("we", "us") runs Kaasu, a personal finance tracker. This policy explains what we collect, why, and the choices you have. You can reach us ${contact}.`],
  },
  {
    h: "What we collect",
    p: [
      "Your account: your email address, and your name and email if you sign in with Google.",
      "What you enter: holdings, transactions, spending and income entries, budgets, loans and EMIs, goals and settings. It is stored in your account so it can sync across your devices.",
      "Technical data: our hosting providers log standard request information (such as IP address and device type) for security and operations.",
      "What we do not collect: bank logins or passwords, card numbers, PAN or Aadhaar. Kaasu does not connect to your bank. Please don't type secrets into free-text notes.",
    ],
  },
  {
    h: "How we use it",
    p: [
      "To provide the service: sign you in, store and sync your data, work out your numbers, and fetch prices for the securities you track.",
      "To keep the service safe: preventing abuse, fixing faults and answering support requests.",
      "We do not show ads, sell your data, or build advertising profiles. We do not use third-party analytics trackers.",
    ],
  },
  {
    h: "Who handles your data",
    p: [
      "We use service providers to run Kaasu: a database and sign-in provider (Supabase), a hosting provider for the web app, and an edge network provider for our price service (Cloudflare). Your sign-in emails are sent by an email provider.",
      "To show prices, our price service asks public sources (AMFI, Google Finance and Yahoo Finance) for the stock symbols and fund scheme codes you track. That service therefore sees which securities you ask about, together with your account's sign-in token. It does not receive your quantities, amounts or any other holdings data.",
    ],
  },
  {
    h: "Security, and its limits",
    p: [
      "Data is encrypted in transit and at rest by our providers, and database rules stop one account from reading another's data.",
      "Your data is not end-to-end encrypted. That means people who operate the service and have database access could technically read it, so we limit who has that access. If that is not acceptable to you, you can use the app with your data kept out of the cloud by exporting a backup and deleting your account.",
    ],
  },
  {
    h: "Your choices and rights",
    p: [
      "Export: Settings → Backup downloads all your data.",
      "Delete: Settings → Account → Danger zone → Delete account removes your login and all the data stored in your account. Copies held in provider backups are removed as those backups expire.",
      "You can correct your data in the app at any time. Under India's Digital Personal Data Protection Act, 2023, you may also ask to access, correct or erase your personal data, and to have a grievance addressed. Write to us " + contact + ".",
    ],
  },
  {
    h: "Storage on your device",
    p: ["Your browser keeps a copy of your data for speed and offline use, and a sign-in session. We do not use advertising cookies."],
  },
  {
    h: "Children",
    p: ["Kaasu is for people aged 18 and over."],
  },
  {
    h: "Changes",
    p: ["If we make a material change to this policy we will tell you in the app or by email before it applies."],
  },
];

const TERMS: Section[] = [
  {
    h: "Agreement",
    p: [`By creating an account or using Kaasu you agree to these terms with ${COMPANY_NAME}. If you don't agree, please don't use the service.`],
  },
  {
    h: "What Kaasu is, and isn't",
    p: [
      "Kaasu helps you track your salary, spending, investments and debts, and works out figures such as returns, tax estimates and what is safe to spend.",
      "It is not investment, tax, legal or financial advice. We are not a SEBI-registered investment adviser or research analyst. Figures, including tax estimates, are simplified and may omit things that apply to you (for example surcharge, carried-forward losses and grandfathering). Check anything important with a qualified professional.",
    ],
  },
  {
    h: "Your account",
    p: ["You must be 18 or over and give a real email address. You are responsible for activity on your account and for keeping your sign-in email secure. Tell us promptly if you think someone else has access."],
  },
  {
    h: "Your data",
    p: ["You own the data you enter. You give us permission to store and process it only to run the service for you, as described in the Privacy Policy. You can export it or delete your account at any time."],
  },
  {
    h: "Prices and third-party data",
    p: ["Prices and fund values come from public sources, some unofficial, and may be delayed, wrong or unavailable. Every price shows its date and source. Don't rely on Kaasu for trading decisions that depend on live accuracy."],
  },
  {
    h: "Acceptable use",
    p: ["Don't misuse the service: no scraping or hammering the price service, no attempts to access other people's data, no reverse engineering that harms the service, and nothing unlawful. We may rate-limit or suspend accounts that put the service at risk."],
  },
  {
    h: "Availability and warranty",
    p: ["Kaasu is provided as is and as available. We work to keep it running and your data safe, but we can't promise it will always be uninterrupted or error-free. Keep your own backups of anything you can't afford to lose."],
  },
  {
    h: "Liability",
    p: ["To the extent the law allows, we are not liable for investment or financial decisions you make using Kaasu, or for indirect or consequential loss. Nothing here limits liability that can't legally be limited."],
  },
  {
    h: "Ending things",
    p: ["You can stop using Kaasu and delete your account whenever you like. We may suspend or end accounts that break these terms."],
  },
  {
    h: "Changes and law",
    p: ["We may update these terms and will tell you about material changes in advance. These terms are governed by the laws of India."],
  },
  {
    h: "Contact",
    p: [`Questions? Reach us ${contact}.`],
  },
];

export function LegalPage({ doc, standalone }: { doc: "privacy" | "terms"; standalone?: boolean }) {
  const sections = doc === "privacy" ? PRIVACY : TERMS;
  const title = doc === "privacy" ? "Privacy Policy" : "Terms of Use";
  return (
    <div className={standalone ? "mx-auto min-h-dvh max-w-3xl px-5 py-6" : "mx-auto max-w-3xl"}>
      {standalone && (
        <header className="mb-8 flex items-center justify-between">
          <Logo />
          <Link to="/" className="text-sm font-semibold text-accent">
            ← Back
          </Link>
        </header>
      )}
      <h1 className="display text-4xl font-extrabold">{title}</h1>
      <p className="mt-2 text-sm text-muted">Last updated {UPDATED}</p>
      <div className="mt-8 flex flex-col gap-7">
        {sections.map((s) => (
          <section key={s.h}>
            <h2 className="display text-xl font-bold">{s.h}</h2>
            {s.p.map((t, i) => (
              <p key={i} className="mt-2 text-[15px] leading-relaxed text-muted">
                {t}
              </p>
            ))}
          </section>
        ))}
      </div>
      <p className="mt-10 text-sm text-muted">
        <Link to={doc === "privacy" ? "/terms" : "/privacy"} className="font-semibold text-accent">
          {doc === "privacy" ? "Terms of Use" : "Privacy Policy"} →
        </Link>
      </p>
    </div>
  );
}
