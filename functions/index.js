const admin = require("firebase-admin");
const Stripe = require("stripe");
const { defineSecret, defineString } = require("firebase-functions/params");
const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { logger } = require("firebase-functions");

admin.initializeApp();
const db = admin.firestore();
const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");
const stripePricePremiumMonthly = defineString("STRIPE_PRICE_PREMIUM_MONTHLY", { default: "" });
const stripePricePremiumYearly = defineString("STRIPE_PRICE_PREMIUM_YEARLY", { default: "" });

const TOPICS = [
  { id: "dermatology", name: "Dermatology", module: "Skin Cancer and Procedures" },
  { id: "nursing", name: "Nursing", module: "Assessment" },
  { id: "pharmacology", name: "Pharmacology", module: "Clinical Use" },
  { id: "cardiology", name: "Cardiology", module: "Disease" },
  { id: "anatomy", name: "Anatomy and Physiology", module: "Clinical Skills" },
  { id: "mental", name: "Mental Health", module: "Assessment" },
  { id: "emergency", name: "Emergency Care", module: "Medical" },
  { id: "epidemiology", name: "Epidemiology", module: "Public Data" },
  { id: "nutrition", name: "Nutrition", module: "Disease" },
  { id: "oncology", name: "Oncology", module: "Support" },
  { id: "infection", name: "Infection Control", module: "Programs" },
  { id: "lab", name: "Lab and Diagnostics", module: "Reasoning" },
  { id: "publichealth", name: "Public Health", module: "Prevention" },
  { id: "internal", name: "Internal Medicine", module: "Practice" },
  { id: "surgery", name: "Surgery", module: "Complications" },
  { id: "neurology", name: "Neurology", module: "Emergencies" },
  { id: "pediatrics", name: "Pediatrics", module: "Acute" },
  { id: "genpractice", name: "General Practice", module: "Primary Care" }
];

const BANK = {
  dermatology: ["Rash with fever red flags", "When a mole needs urgent evaluation", "Eczema flare action plans", "Skin infection versus inflammation", "Hair loss workup basics"],
  nursing: ["Sepsis bedside escalation", "Post fall assessment", "Chest pain nursing response", "Safe discharge teaching", "Change in mental status workflow"],
  pharmacology: ["Medication interactions patients ask about", "Renal dose adjustment workflow", "Safe opioid prescribing concepts", "Antibiotic allergy clarification", "Polypharmacy review"],
  cardiology: ["Chest pain differential diagnosis", "When palpitations are dangerous", "Heart failure weight gain action plan", "Hypertension home readings", "Anticoagulation bleeding counseling"],
  anatomy: ["Why vital signs change in shock", "Inflammation explained clinically", "Pain pathways and referred pain", "Fluid shifts and edema", "Oxygen delivery physiology"],
  mental: ["Suicide safety plan basics", "Panic attack versus medical emergency", "Depression screening workflow", "Substance use brief intervention", "Insomnia clinical counseling"],
  emergency: ["Shortness of breath first approach", "Syncope red flags", "Abdominal pain danger signs", "Fever in high risk patients", "Severe headache emergency signs"],
  epidemiology: ["How to interpret absolute risk", "Screening test false positives", "Outbreak line list basics", "Bias in medical studies", "Vaccine effectiveness interpretation"],
  nutrition: ["Diabetes plate method counseling", "Unintentional weight loss assessment", "Low sodium diet teaching", "Protein needs in older adults", "Food insecurity screening"],
  oncology: ["Cancer warning symptoms", "Neutropenic fever recognition", "Cancer treatment side effect triage", "Survivorship care questions", "Palliative care conversation basics"],
  infection: ["When isolation is needed", "Antibiotic time out workflow", "Needlestick first steps", "Hand hygiene audit basics", "C difficile prevention counseling"],
  lab: ["Abnormal CBC first look", "Hyponatremia interpretation basics", "Liver enzyme pattern recognition", "Urinalysis contamination clues", "Troponin interpretation pitfalls"],
  publichealth: ["Social needs screening", "Vaccine hesitancy conversation", "Community outbreak communication", "Health literacy assessment", "Preventive screening outreach"],
  internal: ["Fatigue differential diagnosis", "Dizziness in adults", "Medication reconciliation in complex patients", "Hospital discharge follow up", "Multimorbidity visit planning"],
  surgery: ["Postoperative wound concern triage", "Acute abdomen red flags", "Postoperative fever timing", "Drain output assessment", "When pain after surgery is unsafe"],
  neurology: ["FAST stroke recognition", "New headache red flags", "Seizure first aid counseling", "Weakness localization basics", "Delirium versus dementia"],
  pediatrics: ["Fever by age risk", "Respiratory distress in children", "Dehydration signs in children", "Rash with fever in pediatrics", "Medication dosing safety"],
  genpractice: ["Chest pain in primary care", "Back pain red flags", "Test result follow up systems", "Preventive visit planning", "Shared decision making scripts"]
};

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function buildLesson(topic, title) {
  return {
    title,
    module: topic.module,
    generatedBy: "daily-healthpath-firebase",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    summary: `${title} is a practical ${topic.name} topic that health learners and professionals commonly need during study, clinical review, patient counseling, or triage.`,
    objectives: [
      `Explain ${title.toLowerCase()} in plain language.`,
      "Identify warning signs that require escalation or urgent evaluation.",
      "Use a structured workflow for assessment, documentation, and follow-up."
    ],
    redFlags: [
      "Abnormal vital signs, rapidly worsening symptoms, altered mental status, severe pain, respiratory distress, syncope, bleeding, or dehydration.",
      "High-risk context such as pregnancy, infancy, older age, immunocompromise, recent surgery, chemotherapy, major comorbidity, or unreliable follow-up.",
      "Clinical uncertainty where delay could cause harm."
    ],
    workflow: [
      "Clarify the main concern, timing, severity, associated symptoms, medications, allergies, relevant history, and patient goals.",
      "Separate stable learning or routine care from danger signs that need escalation.",
      "Document the reason for the plan, what was ruled in or out, teaching provided, and when reassessment should happen."
    ],
    commonMistakes: [
      "Treating a label instead of reassessing the patient in context.",
      "Missing red flags because the presentation seems common.",
      "Giving education without checking understanding, barriers, cost, language, or follow-up."
    ],
    patientExplanation: `A patient-friendly explanation of ${title.toLowerCase()} should avoid jargon, explain why it matters, name the next safe step, and describe symptoms that should prompt urgent help.`,
    quiz: {
      q: `For ${title}, what is the safest learning habit?`,
      opts: [
        "Use a structured assessment, look for red flags, document clearly, and escalate when needed.",
        "Assume common symptoms are never serious.",
        "Skip follow-up instructions if the patient seems to understand.",
        "Use the same plan for every person with the same topic."
      ],
      ans: 0,
      exp: "Safe health education combines structured assessment, red flag recognition, documentation, patient-centered teaching, and escalation when risk is present."
    }
  };
}

exports.addDailyLessons = onSchedule(
  { schedule: "every 24 hours", timeZone: "America/Phoenix", region: "us-central1" },
  async () => {
    const today = new Date().toISOString().slice(0, 10);
    const batch = db.batch();
    const added = [];

    for (const topic of TOPICS) {
      const topicBank = BANK[topic.id] || [];
      const topicRef = db.collection("topicLessons").doc(topic.id);
      const existing = await topicRef.collection("lessons").get();
      const existingIds = new Set(existing.docs.map(doc => doc.id));
      const title = topicBank.find(candidate => !existingIds.has(slug(candidate)));
      if (!title) continue;

      const lessonRef = topicRef.collection("lessons").doc(slug(title));
      batch.set(lessonRef, buildLesson(topic, title), { merge: true });
      added.push(`${topic.name}: ${title}`);
    }

    await batch.commit();
    await db.collection("dailyLessonRuns").doc(today).set({
      date: today,
      added,
      count: added.length,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    logger.info("Daily HealthPath lessons added", { count: added.length, added });
  }
);

function weekStartMs(ts = Date.now()) {
  const d = new Date(ts);
  const day = d.getDay(); // 0 Sun
  const diff = (day + 6) % 7; // Monday start
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - diff);
  return d.getTime();
}

function avgScore(scores = {}) {
  const values = Object.values(scores || {}).map(v => Number(v)).filter(v => Number.isFinite(v));
  if (!values.length) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

function dueCount(review = {}) {
  const now = Date.now();
  return Object.values(review || {}).filter(r => Number(r && r.due) <= now).length;
}

function completionsThisWeek(doneAt = {}) {
  const start = weekStartMs(Date.now());
  return Object.values(doneAt || {}).map(v => Number(v)).filter(ts => Number.isFinite(ts) && ts >= start).length;
}

// Weekly digest writer. For email delivery, pair with Firebase Extensions:
// "Trigger Email" (writes documents to `mail` collection).
exports.sendWeeklyDigests = onSchedule(
  { schedule: "every monday 08:00", timeZone: "America/Phoenix", region: "us-central1" },
  async () => {
    const snap = await db.collection("users").where("profile.digestWeekly", "==", true).get();
    const now = admin.firestore.FieldValue.serverTimestamp();
    const today = new Date().toISOString().slice(0, 10);
    let queued = 0;

    for (const docSnap of snap.docs) {
      const data = docSnap.data() || {};
      const profile = data.profile || {};
      const progress = data.progress || {};
      const email = String(profile.email || "").trim();
      if (!email) continue;

      const doneTotal = Array.isArray(progress.done) ? progress.done.length : 0;
      const readTotal = Array.isArray(progress.read) ? progress.read.length : 0;
      const avg = avgScore(progress.scores);
      const due = dueCount(progress.review);
      const doneWeek = completionsThisWeek(progress.doneAt);

      const subject = `Your HealthPath weekly digest (${today})`;
      const lines = [
        `Completed since Monday: ${doneWeek}`,
        `Reviews due now: ${due}`,
        `Total completed lessons: ${doneTotal}`,
        `Lessons opened: ${readTotal}`,
        `Average quiz score: ${avg === null ? "—" : `${avg}%`}`,
        "",
        "Quick next steps:",
        "- Open Review Mode for due items",
        "- Do a 10-question Exam Mode block",
        "- Keep sessions short and consistent",
        "",
        "Open the academy: https://healthpath-academy.web.app/app.html",
        "To stop these emails: open Progress and toggle Email weekly off.",
        "",
        "Educational only. Follow local protocols and professional supervision.",
      ];

      const text = lines.join("\n");
      const html = `
        <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.5;color:#0f172a">
          <h2 style="margin:0 0 8px">HealthPath weekly digest</h2>
          <p style="margin:0 0 10px;color:#475569">${today}</p>
          <ul style="margin:0 0 14px;padding-left:18px">
            <li><b>${doneWeek}</b> completed since Monday</li>
            <li><b>${due}</b> reviews due now</li>
            <li><b>${doneTotal}</b> total completed lessons</li>
            <li><b>${readTotal}</b> lessons opened</li>
            <li><b>${avg === null ? "—" : `${avg}%`}</b> average quiz score</li>
          </ul>
          <p style="margin:0 0 12px"><b>Quick next steps:</b> Review Mode → Exam Mode (10 questions) → 1 lesson.</p>
          <p style="margin:0 0 12px"><a href="https://healthpath-academy.web.app/app.html">Open HealthPath Academy</a></p>
          <p style="margin:0 0 12px;color:#475569">To stop these emails: open Progress and toggle <b>Email weekly</b> off.</p>
          <p style="margin:0;color:#64748b;font-size:12px">Educational only. Follow local protocols and professional supervision.</p>
        </div>
      `.trim();

      await db.collection("mail").add({
        to: email,
        message: { subject, text, html },
        createdAt: now,
        meta: { kind: "weeklyDigest", uid: profile.uid || docSnap.id, date: today }
      });

      await db.collection("users").doc(docSnap.id).set({
        digest: { lastQueuedAt: now, lastQueuedDate: today }
      }, { merge: true });

      queued += 1;
    }

    await db.collection("digestRuns").doc(today).set({
      date: today,
      queued,
      createdAt: now,
    }, { merge: true });

    logger.info("Weekly digests queued", { queued, date: today });
  }
);

function getStripe() {
  return new Stripe(stripeSecretKey.value(), {
    apiVersion: "2026-02-25.clover",
  });
}

function premiumPriceId(plan) {
  return plan === "yearly" ? stripePricePremiumYearly.value() : stripePricePremiumMonthly.value();
}

function checkoutOrigin(req) {
  const allowed = new Set([
    "https://healthpathacademy.net",
    "https://healthpath-academy.web.app",
    "http://localhost:5173",
    "http://localhost:5000",
  ]);
  const origin = req.get("origin");
  if (origin && allowed.has(origin)) return origin;
  return "https://healthpathacademy.net";
}

async function requireFirebaseUser(req) {
  const authHeader = req.get("authorization") || "";
  const match = authHeader.match(/^Bearer (.+)$/i);
  if (!match) {
    const err = new Error("Missing Firebase ID token.");
    err.status = 401;
    throw err;
  }
  try {
    return await admin.auth().verifyIdToken(match[1]);
  } catch (error) {
    const err = new Error("Invalid Firebase ID token.");
    err.status = 401;
    throw err;
  }
}

async function getUserBilling(uid) {
  if (!uid) return {};
  const docSnap = await db.collection("users").doc(uid).get();
  return docSnap.exists ? (docSnap.data().billing || {}) : {};
}

async function updateUserBilling(uid, billing) {
  if (!uid) return;
  await db.collection("users").doc(uid).set({
    billing: {
      ...billing,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
  }, { merge: true });
}

async function updateBillingBySubscription(subscriptionId, billing) {
  if (!subscriptionId) return;
  const snap = await db.collection("users").where("billing.stripeSubscriptionId", "==", subscriptionId).limit(5).get();
  await Promise.all(snap.docs.map(docSnap => updateUserBilling(docSnap.id, billing)));
}

function subscriptionBilling(subscription) {
  const active = ["active", "trialing"].includes(subscription.status);
  const priceId = subscription.items?.data?.[0]?.price?.id || "";
  return {
    premium: active,
    status: subscription.status,
    plan: subscription.metadata?.plan || "",
    stripeCustomerId: subscription.customer || "",
    stripeSubscriptionId: subscription.id,
    priceId,
    currentPeriodEnd: subscription.current_period_end || null,
    cancelAtPeriodEnd: !!subscription.cancel_at_period_end,
  };
}

function checkoutErrorMessage(error) {
  if (error && error.type === "StripeAuthenticationError") {
    return "Stripe secret key is invalid. Update STRIPE_SECRET_KEY in Firebase.";
  }
  return error.message || "Checkout failed.";
}

exports.createCheckoutSession = onRequest(
  { region: "us-central1", cors: true, secrets: [stripeSecretKey] },
  async (req, res) => {
    if (req.method !== "POST") {
      res.set("Allow", "POST").status(405).json({ error: "Method not allowed." });
      return;
    }

    try {
      const user = await requireFirebaseUser(req);
      const plan = req.body?.plan === "yearly" ? "yearly" : "monthly";
      const priceId = premiumPriceId(plan);
      if (!priceId) {
        res.status(500).json({ error: `Missing Stripe price ID for ${plan}.` });
        return;
      }

      const origin = checkoutOrigin(req);
      const existingBilling = await getUserBilling(user.uid);
      const session = await getStripe().checkout.sessions.create({
        mode: "subscription",
        customer: existingBilling.stripeCustomerId || undefined,
        customer_email: existingBilling.stripeCustomerId ? undefined : user.email || undefined,
        client_reference_id: user.uid,
        line_items: [{ price: priceId, quantity: 1 }],
        metadata: { uid: user.uid, plan },
        subscription_data: {
          metadata: { uid: user.uid, plan },
        },
        allow_promotion_codes: true,
        success_url: `${origin}/app.html?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/app.html?checkout=cancelled`,
      });

      res.status(200).json({ url: session.url });
    } catch (error) {
      logger.error("Stripe checkout session failed", error);
      res.status(error.status || 500).json({ error: checkoutErrorMessage(error) });
    }
  }
);

exports.createBillingPortalSession = onRequest(
  { region: "us-central1", cors: true, secrets: [stripeSecretKey] },
  async (req, res) => {
    if (req.method !== "POST") {
      res.set("Allow", "POST").status(405).json({ error: "Method not allowed." });
      return;
    }

    try {
      const user = await requireFirebaseUser(req);
      const billing = await getUserBilling(user.uid);
      if (!billing.stripeCustomerId) {
        res.status(400).json({ error: "No Stripe customer found for this account." });
        return;
      }

      const origin = checkoutOrigin(req);
      const session = await getStripe().billingPortal.sessions.create({
        customer: billing.stripeCustomerId,
        return_url: `${origin}/app.html#settings`,
      });

      res.status(200).json({ url: session.url });
    } catch (error) {
      logger.error("Stripe billing portal session failed", error);
      res.status(error.status || 500).json({ error: error.message || "Billing portal failed." });
    }
  }
);

exports.stripeWebhook = onRequest(
  { region: "us-central1", secrets: [stripeSecretKey, stripeWebhookSecret] },
  async (req, res) => {
    if (req.method !== "POST") {
      res.set("Allow", "POST").status(405).send("Method not allowed.");
      return;
    }

    const stripe = getStripe();
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.rawBody,
        req.get("stripe-signature"),
        stripeWebhookSecret.value()
      );
    } catch (error) {
      logger.warn("Stripe webhook signature check failed", error.message);
      res.status(400).send(`Webhook Error: ${error.message}`);
      return;
    }

    try {
      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const subscription = session.subscription
          ? await stripe.subscriptions.retrieve(session.subscription)
          : null;
        await updateUserBilling(session.metadata?.uid || session.client_reference_id, {
          ...(subscription ? subscriptionBilling(subscription) : { premium: true, status: "active" }),
          plan: session.metadata?.plan || "",
          stripeCustomerId: session.customer || "",
          stripeSubscriptionId: session.subscription || "",
          stripeCheckoutSessionId: session.id,
          priceId: subscription?.items?.data?.[0]?.price?.id || premiumPriceId(session.metadata?.plan),
        });
      }

      if (event.type === "customer.subscription.created") {
        const subscription = event.data.object;
        await updateUserBilling(subscription.metadata?.uid, subscriptionBilling(subscription));
      }

      if (event.type === "customer.subscription.updated") {
        const subscription = event.data.object;
        await updateBillingBySubscription(subscription.id, subscriptionBilling(subscription));
      }

      if (event.type === "customer.subscription.deleted") {
        const subscription = event.data.object;
        await updateBillingBySubscription(subscription.id, {
          premium: false,
          status: subscription.status || "canceled",
          stripeCustomerId: subscription.customer || "",
          stripeSubscriptionId: subscription.id,
        });
      }

      res.status(200).json({ received: true });
    } catch (error) {
      logger.error("Stripe webhook handling failed", error);
      res.status(500).send("Webhook handler failed.");
    }
  }
);
