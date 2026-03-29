const { createClient } = require("@supabase/supabase-js");
const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const PDFDocument = require("pdfkit");

const GRAPH_API = "https://graph.facebook.com/v22.0";

let _supabase = null;
function db() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
  }
  return _supabase;
}

let _s3 = null;
function r2() {
  if (!_s3) {
    _s3 = new S3Client({
      region: "auto",
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY,
        secretAccessKey: process.env.R2_SECRET_KEY,
      },
    });
  }
  return _s3;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { user_id, payment_id, amount, phone_number } = req.body;

    if (!user_id || !amount) {
      return res.status(400).json({ error: "Missing required fields: user_id, amount" });
    }

    // 1. Fetch user details
    const { data: user, error: userErr } = await db()
      .from("users")
      .select("id, display_name, phone_number")
      .eq("id", user_id)
      .single();

    if (userErr || !user) {
      console.error("[invoice] User not found:", userErr);
      return res.status(404).json({ error: "User not found" });
    }

    const customerName = user.display_name || "Evara User";
    const customerPhone = phone_number || user.phone_number;

    // 2. Generate invoice number
    const invoiceNumber = `EVR-${Date.now().toString(36).toUpperCase()}`;

    // 3. Generate PDF
    const now = new Date();
    const invoiceDate = formatDate(now);
    const validFrom = formatShortDate(now);
    const validTo = formatShortDate(new Date(now.getFullYear() + 1, now.getMonth(), now.getDate()));
    const amountNum = Number(amount);

    const pdfBuffer = await generatePDF({
      invoiceNumber,
      invoiceDate,
      paymentId: payment_id,
      customerName,
      customerPhone,
      amount: amountNum,
      validFrom,
      validTo,
    });

    // 4. Upload to R2
    const bucket = process.env.R2_BUCKET || "evara-documents";
    const fileKey = `invoices/${user_id}/${invoiceNumber}.pdf`;

    await r2().send(new PutObjectCommand({
      Bucket: bucket,
      Key: fileKey,
      Body: pdfBuffer,
      ContentType: "application/pdf",
    }));

    console.log(`[invoice] Uploaded ${pdfBuffer.length} bytes → ${fileKey}`);

    // 5. Store invoice record in Supabase
    const { error: insertErr } = await db()
      .from("invoices")
      .insert({
        user_id,
        invoice_number: invoiceNumber,
        payment_id: payment_id || null,
        amount: amountNum,
        plan: "individual",
        file_key: fileKey,
      });

    if (insertErr) {
      console.error("[invoice] Failed to save invoice record:", insertErr);
    }

    // 6. Generate pre-signed URL (24 hours)
    const presignedUrl = await getSignedUrl(
      r2(),
      new GetObjectCommand({ Bucket: bucket, Key: fileKey }),
      { expiresIn: 86400 }
    );

    // 7. Send PDF via WhatsApp
    if (customerPhone) {
      const caption =
        `🧾 Invoice for Evara Pro\n\n` +
        `Invoice: ${invoiceNumber}\n` +
        `Date: ${invoiceDate}\n` +
        `Amount: ₹${amountNum}\n` +
        `Payment ID: ${payment_id || "N/A"}`;

      await sendDocument(customerPhone, presignedUrl, `Invoice-${invoiceNumber}.pdf`, caption);
      console.log(`[invoice] Sent invoice ${invoiceNumber} to ${customerPhone}`);
    }

    // 8. Return success
    return res.status(200).json({
      success: true,
      invoice_number: invoiceNumber,
      url: presignedUrl,
    });
  } catch (err) {
    console.error("[invoice] Error:", err);
    return res.status(500).json({ error: "Invoice generation failed" });
  }
};

// ── PDF Generation ──────────────────────────────────────────────────────────

function generatePDF({ invoiceNumber, invoiceDate, paymentId, customerName, customerPhone, amount, validFrom, validTo }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const TEAL = "#128C7E";
    const ORANGE = "#FF6B35";
    const GRAY = "#666666";
    const DARK = "#333333";
    const GREEN_BG = "#DCF8C6";
    const pageWidth = doc.page.width - 100; // 50 margin each side

    // ── Header ──
    doc.fontSize(28).fillColor(TEAL).text("evara", 50, 50, { continued: true });
    doc.fillColor(ORANGE).text(".", { continued: false });
    doc.fontSize(14).fillColor(GRAY).text("TAX INVOICE", 400, 55, { align: "right" });

    // ── Divider ──
    doc.moveTo(50, 90).lineTo(545, 90).strokeColor(TEAL).lineWidth(2).stroke();

    // ── Company Info (left) ──
    let y = 110;
    doc.fontSize(10).fillColor(DARK);
    doc.font("Helvetica-Bold").text("Evara App", 50, y);
    doc.font("Helvetica").fillColor(GRAY);
    y += 16;
    doc.text("Singayapalli, Hakimpet", 50, y);
    y += 14;
    doc.text("Hyderabad, Telangana 500078", 50, y);
    y += 14;
    doc.text("India", 50, y);
    y += 14;
    doc.text("Email: support@evara-app.com", 50, y);
    y += 14;
    doc.text("Web: evara-app.com", 50, y);

    // ── Invoice Details (right) ──
    let ry = 110;
    doc.fontSize(10).fillColor(DARK).font("Helvetica");
    doc.text(`Invoice Number: ${invoiceNumber}`, 350, ry, { align: "right" });
    ry += 16;
    doc.text(`Invoice Date: ${invoiceDate}`, 350, ry, { align: "right" });
    ry += 16;
    doc.text(`Payment ID: ${paymentId || "N/A"}`, 350, ry, { align: "right" });

    // ── Bill To ──
    y = 210;
    doc.moveTo(50, y).lineTo(545, y).strokeColor("#DDDDDD").lineWidth(0.5).stroke();
    y += 15;
    doc.fontSize(10).fillColor(TEAL).font("Helvetica-Bold").text("BILL TO", 50, y);
    y += 18;
    doc.fillColor(DARK).text(customerName, 50, y);
    y += 16;
    doc.font("Helvetica").fillColor(GRAY).text(`Phone: +${customerPhone}`, 50, y);

    // ── Table ──
    y += 35;
    const tableTop = y;
    const col1 = 50;
    const col2 = 330;
    const col3 = 400;
    const col4 = 475;

    // Table header
    doc.rect(50, tableTop, 495, 25).fill(TEAL);
    doc.fontSize(9).fillColor("#FFFFFF").font("Helvetica-Bold");
    doc.text("DESCRIPTION", col1 + 10, tableTop + 8);
    doc.text("QTY", col2, tableTop + 8);
    doc.text("RATE", col3, tableTop + 8);
    doc.text("AMOUNT", col4, tableTop + 8);

    // Table row
    const rowTop = tableTop + 25;
    doc.rect(50, rowTop, 495, 40).fill("#F9F9F9");
    doc.fontSize(10).fillColor(DARK).font("Helvetica-Bold");
    doc.text("Evara Pro — 1 Year Plan", col1 + 10, rowTop + 8);
    doc.font("Helvetica").fillColor(GRAY).fontSize(8);
    doc.text("Unlimited scans, 1GB storage, reminders", col1 + 10, rowTop + 22);
    doc.fontSize(10).fillColor(DARK).font("Helvetica");
    const fmtAmount = `₹${amount.toFixed(2)}`;
    doc.text("1", col2, rowTop + 8);
    doc.text(fmtAmount, col3, rowTop + 8);
    doc.text(fmtAmount, col4, rowTop + 8);

    // ── Totals ──
    let ty = rowTop + 55;
    doc.fontSize(10).fillColor(GRAY).font("Helvetica");
    doc.text("Subtotal:", 370, ty);
    doc.text(fmtAmount, col4, ty);
    ty += 18;
    doc.text("GST (0%):", 370, ty);
    doc.text("₹0.00", col4, ty);
    ty += 5;
    doc.moveTo(370, ty + 10).lineTo(545, ty + 10).strokeColor("#DDDDDD").lineWidth(0.5).stroke();
    ty += 20;
    doc.fontSize(12).fillColor(TEAL).font("Helvetica-Bold");
    doc.text("TOTAL:", 370, ty);
    doc.text(fmtAmount, col4, ty);

    // ── Payment Status ──
    ty += 35;
    doc.roundedRect(50, ty, 120, 28, 5).fill(GREEN_BG);
    doc.fontSize(11).fillColor("#2E7D32").font("Helvetica-Bold");
    doc.text("✓ PAID", 65, ty + 8);

    // ── Plan Validity ──
    ty += 45;
    doc.fontSize(10).fillColor(GRAY).font("Helvetica");
    doc.text("Plan Validity:", 50, ty);
    doc.fillColor(DARK).font("Helvetica-Bold");
    doc.text(`${validFrom} — ${validTo}`, 140, ty);

    // ── Footer ──
    const footerY = 700;
    doc.moveTo(50, footerY).lineTo(545, footerY).strokeColor("#DDDDDD").lineWidth(0.5).stroke();
    doc.fontSize(9).fillColor(GRAY).font("Helvetica");
    doc.text("Thank you for choosing Evara Pro!", 50, footerY + 15, { align: "center", width: pageWidth });
    doc.text(
      "This is a computer-generated invoice and does not require a signature.",
      50, footerY + 30, { align: "center", width: pageWidth }
    );
    doc.text(
      "For support, message us on WhatsApp: +91 83094 21405 | evara-app.com",
      50, footerY + 45, { align: "center", width: pageWidth }
    );

    doc.end();
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(date) {
  const months = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  return `${date.getDate()} ${months[date.getMonth()]}, ${date.getFullYear()}`;
}

function formatShortDate(date) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

async function sendDocument(to, url, filename, caption) {
  const apiUrl = `${GRAPH_API}/${process.env.META_PHONE_NUMBER_ID}/messages`;
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "document",
      document: { link: url, filename, caption },
    }),
  });
  if (!res.ok) console.error(`[invoice] sendDocument failed ${res.status}:`, await res.text());
}
