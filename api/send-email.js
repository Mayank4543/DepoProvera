import nodemailer from "nodemailer";

// ── Config ────────────────────────────────────────────────────────────────────
const POST_URL = "https://nlcr.cagsys.com/leadPost.php?cid=53&fid=3224";

// All US states allowed by the spec
const ALLOWED_STATES = new Set([
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DC",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IA",
  "KS",
  "KY",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
]);

// ── Helpers ───────────────────────────────────────────────────────────────────
function digitsOnly(value) {
  return (value || "").toString().replace(/\D/g, "");
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress || "";
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      return res
        .status(500)
        .json({ error: "Missing EMAIL_USER or EMAIL_PASS env vars" });
    }

    const data = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    // ── Field extraction ──────────────────────────────────────────────
    const phone = digitsOnly(data?.phone);
    const mobile = digitsOnly(data?.mobile);
    const state = (data?.state || "").toUpperCase();
    const usedDepoProvera = (data?.UsedDepoProvera || "").trim();

    // ── Required-field validation (per spec) ──────────────────────────
    const errors = {};

    if (!data?.fname) errors.fname = "required";
    if (!data?.lname) errors.lname = "required";
    if (!(phone.length === 10 || phone.length === 11))
      errors.phone = "required, must be 10–11 digits";
    if (!data?.email) errors.email = "required";
    if (!state || !ALLOWED_STATES.has(state))
      errors.state = `required; must be one of the allowed two-letter US state codes`;
    if (!usedDepoProvera || !["Y", "Yes"].includes(usedDepoProvera))
      errors.UsedDepoProvera = "required; must be 'Y' or 'Yes'";
    if (!data?.t_id) errors.t_id = "required (Trusted Form URL)";

    if (Object.keys(errors).length) {
      return res.status(400).json({ status: 4, errors: [errors] });
    }

    // ── IP: prefer form-supplied, fall back to request IP ─────────────
    const ipAddress = (data?.IPAddress || "").trim() || getClientIp(req);

    // ── Assemble full payload (matches spec field names exactly) ──────
    const lead = {
      // Required
      fname: data.fname,
      lname: data.lname,
      phone,
      email: data.email,
      state,
      IPAddress: ipAddress,
      UsedDepoProvera: usedDepoProvera,
      t_id: data.t_id,
      // Optional – contact
      initial: data.initial || "",
      mobile: mobile || "",
     
    };

    // ── Email body ────────────────────────────────────────────────────
    const or = (v) => v || "—";

    const message = `
New Depo Provera Lead — Digital Gen Media CPA Spec
Post URL: ${POST_URL}

━━━ REQUIRED FIELDS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
First Name:            ${or(lead.fname)}
Last Name:             ${or(lead.lname)}
Home Phone:            ${or(lead.phone)}
Email:                 ${or(lead.email)}
State:                 ${or(lead.state)}
Opt-In IP Address:     ${or(lead.IPAddress)}
Used Depo Provera:     ${or(lead.UsedDepoProvera)}
Trusted Form (t_id):   ${or(lead.t_id)}

`.trim();

    // ── Send email ────────────────────────────────────────────────────
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.LEAD_RECEIVER_EMAIL || "mailtoakash@gmail.com",
      subject: `New Depo Provera Lead – ${lead.fname} ${lead.lname}`.trim(),
      text: message,
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("send-email handler error:", error);
    return res.status(500).json({ error: "Email failed" });
  }
}
