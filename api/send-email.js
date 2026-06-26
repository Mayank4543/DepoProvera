import nodemailer from "nodemailer";

const POST_URL = "https://nlcr.cagsys.com/leadPost.php?cid=53&fid=3224";

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

function digitsOnly(value) {
  return (value || "").toString().replace(/\D/g, "");
}

function formatPhone(raw) {
  const d = digitsOnly(raw).replace(/^1/, "");
  if (d.length !== 10) return d;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

// Returns the first valid public IPv4 from request headers
function getRealIp(req) {
  // Vercel sets x-forwarded-for to the actual client IP
  const sources = [
    req.headers["x-forwarded-for"],
    req.headers["x-real-ip"],
    req.headers["cf-connecting-ip"],
  ];

  for (const src of sources) {
    if (!src) continue;
    for (const candidate of src.split(",")) {
      const ip = candidate.trim();
      // Must match IPv4 pattern
      if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) continue;
      const [a, b] = ip.split(".").map(Number);
      // Skip private/loopback ranges
      if (a === 10) continue;
      if (a === 127) continue;
      if (a === 172 && b >= 16 && b <= 31) continue;
      if (a === 192 && b === 168) continue;
      return ip; // first valid public IPv4
    }
  }
  return "";
}

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

    const phoneRaw = digitsOnly(data?.phone);
    const mobileRaw = digitsOnly(data?.mobile);
    const state = (data?.state || "").toUpperCase();
    const usedDepoProvera = (data?.UsedDepoProvera || "").trim();

    // IP always comes from request headers — never trust user input for this
    const ipAddress = getRealIp(req);
    console.log(
      "Client IP resolved:",
      ipAddress,
      "| headers:",
      JSON.stringify({
        "x-forwarded-for": req.headers["x-forwarded-for"],
        "x-real-ip": req.headers["x-real-ip"],
      }),
    );

    // ── Validation ────────────────────────────────────────────────────
    const errors = {};
    if (!data?.fname) errors.fname = "required";
    if (!data?.lname) errors.lname = "required";
    if (!(phoneRaw.length === 10 || phoneRaw.length === 11))
      errors.phone = "required, must be 10–11 digits";
    if (!data?.email) errors.email = "required";
    if (!state || !ALLOWED_STATES.has(state))
      errors.state = "required; must be a valid 2-letter US state";
    if (!usedDepoProvera || !["Y", "Yes"].includes(usedDepoProvera))
      errors.UsedDepoProvera = "required; must be Y or Yes";
    if (!data?.t_id) errors.t_id = "required (Trusted Form URL)";

    if (Object.keys(errors).length) {
      return res.status(400).json({ status: 4, errors: [errors] });
    }

    const phoneFormatted = formatPhone(phoneRaw);
    const mobileFormatted = mobileRaw ? formatPhone(mobileRaw) : "";

    const lead = {
      fname: data.fname,
      lname: data.lname,
      phone: phoneFormatted,
      email: data.email,
      state,
      IPAddress: ipAddress,
      UsedDepoProvera: usedDepoProvera,
      t_id: data.t_id,
      initial: data.initial || "",
      mobile: mobileFormatted,
      address1: data.address1 || "",
      address2: data.address2 || "",
      city: data.city || "",
      zip: data.zip || "",
      Comments: data.Comments || "",
      SubId: data.SubId || "",
      SubId2: data.SubId2 || "",
      clickid: data.clickid || "",
      VendorLeadId: data.VendorLeadId || "",
    };

    // ── POST lead ─────────────────────────────────────────────────────
    const formBody = new URLSearchParams();
    Object.entries(lead).forEach(([key, value]) => {
      if (value !== "") formBody.append(key, value);
    });

    let postStatus = "",
      postResponse = "";
    let postRes;
    try {
      postRes = await fetch(POST_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0 (compatible; LeadPoster/1.0)",
        },
        body: formBody.toString(),
      });
    } catch (networkErr) {
      console.error("Lead POST network error:", networkErr.message);
      return res.status(502).json({
        error: "Network error – could not reach lead endpoint.",
        detail: networkErr.message,
      });
    }

    postResponse = await postRes.text();
    postStatus = `HTTP ${postRes.status} – ${postRes.statusText}`;
    console.log("Lead POST result:", postStatus, "|", postResponse);

    if (!postRes.ok) {
      return res.status(502).json({
        error: "Lead endpoint rejected.",
        status: postStatus,
        response: postResponse,
      });
    }

    // ── Email ─────────────────────────────────────────────────────────
    const or = (v) => v || "—";
    const message = `
New Depo Provera Lead — Digital Gen Media CPA Spec
Post URL: ${POST_URL}

━━━ LEAD POST RESULT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Status:                ${postStatus}
Response:              ${postResponse || "—"}

━━━ REQUIRED FIELDS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
First Name:            ${or(lead.fname)}
Last Name:             ${or(lead.lname)}
Home Phone:            ${or(lead.phone)}
Email:                 ${or(lead.email)}
State:                 ${or(lead.state)}
Opt-In IP Address:     ${or(lead.IPAddress)}
Used Depo Provera:     ${or(lead.UsedDepoProvera)}
Trusted Form (t_id):   ${or(lead.t_id)}

━━━ OPTIONAL – CONTACT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Initial:               ${or(lead.initial)}
Mobile Phone:          ${or(lead.mobile)}

━━━ OPTIONAL – ADDRESS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Address Line 1:        ${or(lead.address1)}
Address Line 2:        ${or(lead.address2)}
City:                  ${or(lead.city)}
Zip:                   ${or(lead.zip)}

━━━ OPTIONAL – TRACKING & NOTES ━━━━━━━━━━━━━━━━━━━
SubId:                 ${or(lead.SubId)}
SubId2:                ${or(lead.SubId2)}
Click ID:              ${or(lead.clickid)}
Vendor Lead ID:        ${or(lead.VendorLeadId)}
Comments:              ${or(lead.Comments)}
`.trim();

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.LEAD_RECEIVER_EMAIL || "mailtoakash@gmail.com",
      subject: `New Depo Provera Lead – ${lead.fname} ${lead.lname}`.trim(),
      text: message,
    });

    return res.status(200).json({
      success: true,
      leadPostStatus: postStatus,
      leadPostResponse: postResponse,
    });
  } catch (error) {
    console.error("Handler error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
