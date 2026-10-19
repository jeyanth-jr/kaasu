# LinkedIn post draft (developer profile, storytelling)

For years, all my wealth lived in a Google Sheet.

One tab for stocks. One for mutual funds. Another for RDs and FDs. GOOGLEFINANCE formulas pulling prices, and a lot of copy-paste on the side. It worked. Until the day some prices just stopped updating, and I realised I didn't fully trust a single number on the screen.

That was the moment I thought: a spreadsheet can store my money, but it can't tell me what happened to it. When my salary lands, where does it go? What's safe to spend this week? Am I on track for the trip, or the home?

So over the holidays I sat down with Claude and turned the sheet into an app. 🪙

Let me be true about how: I orchestrated. Claude wrote most of the code. My job was to decide what to build, push back when the numbers or the experience were wrong, test it, break it, and run the real deployment myself.

What started as "a place to track all my wealth" grew, one honest conversation at a time:
• First, a portfolio tracker with live prices, FIFO lots and XIRR
• Then the thing the sheet never did: a payday flow that lines up SIPs, RDs and EMIs and tells me what's safe to spend
• Then every bank account side by side, with the account named on each transaction
• Then goals, short and long term, and a real debt-free date
• Then the hard part, turning a personal tool into a product: sign-in, private per-user data, CAPTCHA, rate limits, a proper deployment

Under the hood (diagram in the second image): React + TypeScript, local-first so it works offline, a Cloudflare Worker for prices, Supabase for auth and Postgres with row-level security, Vercel for hosting.

What I took away:
1. AI makes building fast. It doesn't make you the owner of the result. Reviewing, testing and deciding is still your job.
2. A test suite that has never failed proves nothing, especially for money maths.
3. Security shows up when you ask for it. Push for it early.
4. Shipping to real infrastructure teaches more than any tutorial.

It's early and it has rough edges. I'd love for you to try it and tell me what's confusing, what's missing, and what you'd break first.

Demo with sample data, no signup: https://kaasu-three.vercel.app

#BuildInPublic #AI #ClaudeCode #React #Supabase #FinTech

---

## Images (in order)
1. A "before" shot: a blurred or fake version of your old sheet (do NOT show real numbers)
2. `hld.png`, the architecture diagram
3. Home screen in demo mode
4. Accounts or Goals page in demo mode

## Check before posting
- The tab list in the opening is my guess at a typical sheet: change it to match yours.
- "Some prices just stopped updating" comes from you telling me only 14 prices were updating. Keep it only if it's the real trigger.
- "Run the real deployment myself": soften it if you'd describe it differently.
- Point 3 is my lesson from the project. Swap in yours if it differs.
