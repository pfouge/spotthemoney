// Guides: I Bonds, the Treasury yield curve, TIPS. See the rules at the top of congress.ts.
// The current I-Bond rate is NEVER typed here: it comes from the database through GuideCtx.
import type { Guide } from "./types";
import type { GuideCtx } from "./ctx";
import { ext, table } from "./html";

const U = "2026-10-08";
const TD_RATES = "https://www.treasurydirect.gov/savings-bonds/i-bonds/i-bonds-interest-rates/";
const PAR = "https://home.treasury.gov/policy-issues/financing-the-government/interest-rate-statistics";

export const ratesGuides: ((c: GuideCtx) => Guide)[] = [
  // ───────────────────────────────────────────────────────────────────────────────────────
  (c) => {
    const r = c.facts.iBondRules, ib = c.ibond;
    const now = ib ? `The current composite rate is ${ib.composite} (fixed rate ${ib.fixed}, six-month inflation rate ${ib.inflation}), for bonds issued from ${ib.effective}.` : "The current rate is shown on the I-Bonds page.";
    return {
      slug: "how-i-bond-rates-work", group: "rates", updated: U,
      title: "How I Bond rates work",
      seoTitle: ["How I Bond Rates Work: Fixed Rate, Inflation Rate, Resets", "How I Bond Rates Work"],
      description: ["An I Bond's rate combines a fixed rate set at purchase with an inflation rate that changes every six months. How the composite is built and when it resets.", "An I Bond's rate combines a fixed rate with an inflation rate that changes every six months. How it is built and when it resets."],
      answer: `A Series I savings bond earns a composite rate made of two parts: a fixed rate that stays with the bond for life, and an inflation rate that changes every six months with the Consumer Price Index. ${now}`,
      keyFacts: [
        "New rates are announced each May 1 and November 1.",
        `The next reset is ${c.nextReset}.`,
        "The fixed rate is locked in on the day you buy; the inflation part moves.",
        `You can buy up to ${c.usd(r.annualLimitUsd)} per person per calendar year.`,
        `A bond cannot be cashed for ${r.minHoldMonths} months, and cashing before ${r.penaltyBeforeYears} years costs the last ${r.penaltyMonths} months of interest.`,
      ],
      sections: [
        { id: "parts", h: "What are the two parts of the rate?", html: `
<p>The <strong>fixed rate</strong> is set by the Treasury when the bond is issued and never changes for that bond. A bond bought when the fixed rate was 0% keeps 0% for thirty years; a bond bought at 1.3% keeps 1.3%.</p>
<p>The <strong>inflation rate</strong> is the change in consumer prices over six months, measured by the CPI-U index (all urban consumers, not seasonally adjusted) from the ${ext("https://www.bls.gov/cpi/", "Bureau of Labor Statistics")}. The May rate uses the change from September to March; the November rate uses March to September.</p>
<p>${now}</p>` },
        { id: "formula", h: "How are they combined?", html: `
<p>The Treasury combines them like this, where the inflation rate is the six-month figure:</p>
<p><strong>composite rate = fixed rate + (2 × inflation rate) + (fixed rate × inflation rate)</strong></p>
<p>The inflation figure is doubled to turn six months into a year, and the last small term accounts for earning the fixed rate on the inflation adjustment. The composite can never fall below zero, so in a period of falling prices a bond stops earning but does not lose value. The Treasury publishes each period's rates on ${ext(TD_RATES, "TreasuryDirect")}.</p>` },
        { id: "reset", h: "When does my bond's rate change?", html: `
<p>Every six months from the month you bought it, not on the announcement dates. A bond bought in February gets each new inflation rate in February and August. So when new rates are announced on ${c.nextReset}, an existing bond switches to them at its own next six-month mark, and until then it keeps earning the previous rate.</p>
<p>This is why the weeks before a reset matter to buyers: buying before the reset locks in the current fixed rate for life and the current inflation rate for six months, with the new inflation rate following. The <a href="/rates/i-bonds/#next-reset">I-Bonds page</a> shows what is already known about the next inflation rate from published price data.</p>` },
        { id: "rules", h: "What are the rules for buying and cashing in?", html: `
<ul>
<li><strong>Limit:</strong> ${c.usd(r.annualLimitUsd)} per person per calendar year, bought electronically through TreasuryDirect. Paper I Bonds through a tax refund are no longer offered.</li>
<li><strong>Lock-up:</strong> no redemption in the first ${r.minHoldMonths} months.</li>
<li><strong>Early penalty:</strong> cashing in before ${r.penaltyBeforeYears} years forfeits the last ${r.penaltyMonths} months of interest.</li>
<li><strong>Life:</strong> a bond earns interest for up to ${r.maxYears} years.</li>
<li><strong>Tax:</strong> interest is subject to federal income tax, which can be put off until the bond is cashed, and is exempt from state and local income tax.</li>
</ul>
<p>Interest is added to the bond's value monthly and compounds every six months. Nothing is paid out until you cash it.</p>` },
        { id: "compare", h: "How is an I Bond different from TIPS?", html: `
<p>Both protect against inflation using the same price index, but they are different things. An I Bond is a savings bond: it is not traded, its value never falls, and purchases are capped. TIPS are marketable Treasury securities: they trade daily, their price can fall when interest rates rise, and there is no practical purchase limit. See ${`<a href="/guides/tips-real-yields-and-breakeven-inflation/">TIPS and real yields</a>`}.</p>
<p>This site reports the rates. Whether either suits you depends on your circumstances, and this is not advice.</p>` },
      ],
      faqs: [
        { q: "What is the current I Bond rate?", a: ib ? `The current I Bond composite rate is ${ib.composite} for bonds issued from ${ib.effective}: a ${ib.fixed} fixed rate plus a six-month inflation rate of ${ib.inflation}. The next reset is ${c.nextReset}.` : `I Bond rates are announced each May 1 and November 1; the next reset is ${c.nextReset}. The live rate is on the I-Bonds page.`, on: ["rates"] },
        { q: "When do I Bond rates change?", a: `The Treasury announces new rates each May 1 and November 1; the next is ${c.nextReset}. An existing bond takes up each new inflation rate every six months counted from its own issue month.`, on: ["rates"] },
        { q: "How much can I buy in I Bonds each year?", a: `Up to ${c.usd(r.annualLimitUsd)} per person per calendar year, bought electronically through TreasuryDirect.` },
        { q: "Can an I Bond lose value?", a: "No. The composite rate cannot go below zero, so a bond's value never falls. Cashing in before five years costs the last three months of interest." },
      ],
      sources: [
        { name: "TreasuryDirect: I bond interest rates", url: TD_RATES },
        { name: "Series I savings bond regulations (31 CFR Part 359)", url: r.source },
        { name: "Annual purchase limit (31 CFR 363.52)", url: "https://www.law.cornell.edu/cfr/text/31/363.52" },
        { name: "BLS Consumer Price Index", url: "https://www.bls.gov/cpi/" },
        { name: "IRS Topic 403: interest received", url: "https://www.irs.gov/taxtopics/tc403" },
      ],
      related: ["tips-real-yields-and-breakeven-inflation", "treasury-yield-curve-explained"],
      seeLive: [{ label: "I Bond rate today and calculator", href: "/rates/i-bonds/" }, { label: "Rates hub", href: "/rates/" }],
      covers: ["web/src/lib/ibond.ts", "web/src/pages/rates/i-bonds.astro"],
      ui: [],
      facts: ["iBondRules"],
    };
  },

  // ───────────────────────────────────────────────────────────────────────────────────────
  () => ({
    slug: "treasury-yield-curve-explained", group: "rates", updated: U,
    title: "The Treasury yield curve explained",
    seoTitle: ["The Treasury Yield Curve Explained: Shape and Inversion", "The Treasury Yield Curve Explained"],
    description: ["The yield curve plots what the U.S. government pays to borrow for one month up to 30 years. What its shape means, what inversion is, and how to read the spreads.", "The yield curve plots U.S. borrowing costs from one month to 30 years. What its shape and an inversion mean."],
    answer: "The Treasury yield curve is a chart of the interest rates on U.S. government debt, from one month out to thirty years, on a single day. It normally slopes upward because lenders want more for tying money up longer; when short-term rates rise above long-term rates the curve is said to be inverted, which has often come before a recession.",
    keyFacts: [
      "The Treasury publishes the curve every business day.",
      "Points run from 1 month to 30 years.",
      "Upward slope is normal; flat or inverted is unusual.",
      "The two spreads people watch: 10-year minus 2-year, and 10-year minus 3-month.",
      "An inversion is a warning sign with a mixed record, not a timetable.",
    ],
    sections: [
      { id: "what", h: "What is the yield curve?", html: `
<p>The yield curve is a line through the yields of Treasury securities of different lengths on the same day. A yield is the annual return a buyer earns by holding the security to the end. Plot the one-month yield on the left and the thirty-year yield on the right, join the dots, and you have the curve.</p>
<p>The official version is the Treasury's ${ext(PAR, "daily par yield curve")}: fourteen points from 1 month to 30 years, worked out each afternoon from market prices of recently issued securities. They are estimates read off a fitted curve, not the result of any single auction.</p>` },
      { id: "securities", h: "What are bills, notes and bonds?", html: `
${table(["Security", "Length", "How it pays"], [
  ["Treasury bills", "4 weeks to 52 weeks", "Sold below face value; no interest payments"],
  ["Treasury notes", "2, 3, 5, 7 and 10 years", "Interest every six months"],
  ["Treasury bonds", "20 and 30 years", "Interest every six months"],
])}
<p>All are backed by the U.S. government, which is why their yields are used as the baseline for every other interest rate, from mortgages to company loans.</p>` },
      { id: "shape", h: "Why does the curve usually slope upward?", html: `
<p>Because time is risk. Someone lending for ten years faces a decade of possible inflation and rate changes and wants to be paid for it, so long yields normally sit above short ones.</p>
<p>The short end follows the Federal Reserve, which sets overnight rates. The long end follows what investors expect for growth and inflation over many years. The shape of the curve is the difference between those two views.</p>` },
      { id: "inversion", h: "What is an inverted yield curve?", html: `
<p>An inverted curve is one where short-term yields are higher than long-term yields. It tends to happen when the Federal Reserve has raised short rates sharply and investors expect it to cut them later, usually because they expect the economy to slow.</p>
<p>Two measures are standard. The <strong>10-year minus 2-year</strong> spread is the common shorthand. The <strong>10-year minus 3-month</strong> spread is the one used in Federal Reserve research on recessions; the ${ext("https://www.clevelandfed.org/indicators-and-data/yield-curve-and-predicted-gdp-growth", "Cleveland Fed")} publishes a model built on it. When either number is below zero, that part of the curve is inverted.</p>
<p>An inverted curve has come before each U.S. recession for decades, but it has also given false alarms, and the delay between inversion and recession has ranged from months to years. It describes what bond investors expect. It does not tell you what will happen or when.</p>` },
      { id: "here", h: "How do I read the curve on this site?", html: `
<p>The <a href="/rates/treasury-yields/">Treasury yields page</a> shows today's curve against the curve a month ago, the two spreads with a note when either is inverted, a table of every maturity with its one-day, one-month and year-to-date change, and a playback of how the curve has moved over the past year. Changes are given in basis points: one basis point is one hundredth of a percentage point, so a move from 4.00% to 4.25% is 25 basis points.</p>
<p>The figures are the Treasury's own, updated each day after they are published.</p>` },
    ],
    faqs: [
      { q: "What is an inverted yield curve?", a: "A yield curve is inverted when short-term Treasury yields are higher than long-term yields. The usual tests are the 10-year yield minus the 2-year, or minus the 3-month, falling below zero.", on: ["rates"] },
      { q: "Does an inverted yield curve mean a recession is coming?", a: "Not necessarily. Inversions have come before past U.S. recessions but have also given false alarms, and the gap between inversion and recession has varied from months to years." },
      { q: "What is a basis point?", a: "A basis point is one hundredth of a percentage point. A yield that moves from 4.00% to 4.25% has risen 25 basis points.", on: ["rates"] },
      { q: "Where do Treasury yield curve rates come from?", a: "The Treasury publishes them every business day. They are estimated from late-afternoon market prices of recently issued Treasury securities, at fourteen maturities from 1 month to 30 years." },
    ],
    sources: [
      { name: "Treasury: interest rate statistics", url: PAR },
      { name: "Treasury: daily par yield curve rates", url: "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve&field_tdr_date_value=2026" },
      { name: "Treasury: yield curve methodology", url: "https://home.treasury.gov/policy-issues/financing-the-government/interest-rate-statistics/treasury-yield-curve-methodology" },
      { name: "Federal Reserve Bank of Cleveland: yield curve and predicted GDP growth", url: "https://www.clevelandfed.org/indicators-and-data/yield-curve-and-predicted-gdp-growth" },
      { name: "Federal Reserve Board: notes on the yield curve as a recession signal", url: "https://www.federalreserve.gov/econres/notes/feds-notes/dont-fear-the-yield-curve-reprise-20220325.html" },
    ],
    related: ["tips-real-yields-and-breakeven-inflation", "how-i-bond-rates-work"],
    seeLive: [{ label: "Treasury yield curve today", href: "/rates/treasury-yields/" }, { label: "Rates hub", href: "/rates/" }],
    covers: ["web/src/pages/rates/treasury-yields.astro"],
    ui: [],
    facts: ["treasuryLineup"],
  }),

  // ───────────────────────────────────────────────────────────────────────────────────────
  (c) => ({
    slug: "tips-real-yields-and-breakeven-inflation", group: "rates", updated: U,
    title: "TIPS, real yields and breakeven inflation",
    seoTitle: ["TIPS, Real Yields and Breakeven Inflation Explained", "TIPS and Real Yields Explained"],
    description: ["TIPS are Treasury securities whose value rises with inflation. What a real yield is, how breakeven inflation is calculated, and what it does and does not forecast.", "TIPS are Treasuries that rise with inflation. What a real yield is and how breakeven inflation is calculated."],
    answer: "TIPS (Treasury Inflation-Protected Securities) are government bonds whose principal rises with the Consumer Price Index, so their yield is a \"real\" yield: the return on top of inflation. Subtracting a TIPS yield from the ordinary Treasury yield of the same length gives breakeven inflation, the inflation rate at which the two would pay the same.",
    keyFacts: [
      "TIPS are sold with 5-, 10- and 30-year terms.",
      "Principal is adjusted with CPI-U; interest is paid on the adjusted amount.",
      "Real yield = return above inflation. It can be negative.",
      "Breakeven inflation = ordinary Treasury yield minus TIPS yield, same maturity.",
      "Breakevens reflect market pricing, which is not the same as a forecast.",
    ],
    sections: [
      { id: "what", h: "What are TIPS?", html: `
<p>TIPS are Treasury securities built to keep pace with prices. The amount you are owed (the principal) is adjusted up as the CPI-U price index rises, and the twice-yearly interest is paid on that adjusted amount. At the end you receive the adjusted principal or the original, whichever is larger.</p>
<p>They are issued for 5, 10 and 30 years and trade every day like other Treasuries, which means their market price moves, sometimes sharply, when interest rates change.</p>` },
      { id: "real-yield", h: "What is a real yield?", html: `
<p>A real yield is the return an investor earns over and above inflation. Because TIPS already compensate for inflation through the principal, the yield quoted on them is a real yield. A 10-year TIPS yielding 2% promises about 2% a year more than inflation for ten years, whatever inflation turns out to be.</p>
<p>Real yields can be negative. When they are, buyers are accepting a guaranteed loss of purchasing power in exchange for safety, as happened in 2012 and again in 2020 and 2021.</p>
<p>The Treasury publishes a ${ext("https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_real_yield_curve&field_tdr_date_value=2026", "daily real yield curve")} at 5, 7, 10, 20 and 30 years.</p>` },
      { id: "breakeven", h: "What is breakeven inflation?", html: `
<p>Breakeven inflation is the ordinary Treasury yield minus the TIPS yield of the same maturity. If the 10-year Treasury yields 4.3% and the 10-year TIPS yields 2.0%, the ten-year breakeven is 2.3%.</p>
<p>The name describes a comparison. If inflation over the ten years averages more than 2.3%, the TIPS holder ends up ahead; if it averages less, the ordinary Treasury does better; at exactly 2.3% they break even.</p>` },
      { id: "forecast", h: "Is breakeven inflation a forecast?", html: `
<p>Only loosely. It is the inflation rate implied by two market prices, and those prices also contain things that have nothing to do with expected inflation: a premium for the risk that inflation surprises, and a discount because TIPS are harder to trade in size than ordinary Treasuries. The ${ext("https://www.federalreserve.gov/data/tips-yield-curve-and-inflation-compensation.htm", "Federal Reserve")} calls the measure "inflation compensation" for that reason.</p>
<p>Treat a breakeven as what the bond market is charging for inflation protection today. It moves with sentiment and with trading conditions, and it has been wrong in both directions.</p>` },
      { id: "here", h: "Where are these on this site?", html: `
<p>The <a href="/rates/tips/">TIPS page</a> shows the real yield at each maturity and the breakeven beside it, from the Treasury's daily figures. For the ordinary curve see the <a href="/rates/treasury-yields/">Treasury yields page</a>, and for the savings-bond cousin of TIPS see ${`<a href="/guides/how-i-bond-rates-work/">how I Bond rates work</a>`}.</p>` },
    ],
    faqs: [
      { q: "What is a real yield?", a: "A real yield is the return on a bond after inflation. Yields on TIPS are real yields because the bond's principal already rises with the Consumer Price Index.", on: ["rates"] },
      { q: "How is breakeven inflation calculated?", a: "Subtract the yield on a TIPS from the yield on an ordinary Treasury of the same maturity. The result is the average inflation rate at which the two would give the same return." },
      { q: "Can TIPS lose money?", a: "Held to maturity, TIPS return at least the original principal plus the inflation adjustment. Sold earlier, they can lose money, because their market price falls when real interest rates rise." },
      { q: "What is the difference between TIPS and I Bonds?", a: `Both follow the same price index. TIPS are traded securities whose price can fall and which have no practical purchase limit; I Bonds are savings bonds that cannot be traded, never lose value, and are limited to ${c.usd(c.facts.iBondRules.annualLimitUsd)} a year per person.` },
    ],
    sources: [
      { name: "Treasury: daily par real yield curve rates", url: "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_real_yield_curve&field_tdr_date_value=2026" },
      { name: "Treasury: interest rate statistics", url: PAR },
      { name: "Federal Reserve: TIPS yield curve and inflation compensation", url: "https://www.federalreserve.gov/data/tips-yield-curve-and-inflation-compensation.htm" },
      { name: "Definition of the inflation index ratio (31 CFR 356.2)", url: "https://www.law.cornell.edu/cfr/text/31/356.2" },
    ],
    related: ["how-i-bond-rates-work", "treasury-yield-curve-explained"],
    seeLive: [{ label: "TIPS real yields today", href: "/rates/tips/" }, { label: "Rates hub", href: "/rates/" }],
    covers: ["web/src/pages/rates/tips.astro"],
    ui: [],
    facts: ["treasuryLineup", "iBondRules"],
  }),
];
