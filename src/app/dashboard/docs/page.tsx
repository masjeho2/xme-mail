"use client";

export default function DocsPage() {
  const appUrl = typeof window !== "undefined" ? window.location.origin : "https://mail.x-me.cloud";

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="page-title">API Docs</h1>
        <p className="page-sub">Kirim email dari app lain pakai API key</p>
      </div>

      <div className="card p-5 md:p-6 space-y-5">
        <div>
          <div className="font-semibold text-lg">POST /api/v1/send</div>
          <div className="muted text-sm mt-1">
            Header: <code className="mono text-blue-200">Authorization: Bearer xme_...</code>
          </div>
        </div>

        <pre className="bg-black/35 border border-[var(--border)] rounded-xl p-4 text-sm overflow-x-auto mono whitespace-pre-wrap text-blue-50/90">{`curl -X POST ${appUrl}/api/v1/send \\
  -H "Authorization: Bearer xme_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "from": "noreply@x-me.cloud",
    "to": "user@gmail.com",
    "subject": "OTP kamu",
    "text": "Kode: 123456"
  }'`}</pre>

        <div className="border-t border-[var(--border-soft)] pt-5">
          <div className="font-semibold mb-2">Inbound webhook (Cloudflare Worker)</div>
          <pre className="bg-black/35 border border-[var(--border)] rounded-xl p-4 text-sm overflow-x-auto mono whitespace-pre-wrap text-blue-50/90">{`curl -X POST ${appUrl}/api/inbound/cloudflare \\
  -H "X-Webhook-Secret: YOUR_WEBHOOK_SECRET" \\
  -H "Content-Type: application/json" \\
  -d '{
    "from": "someone@gmail.com",
    "to": "admin@x-me.cloud",
    "subject": "Halo",
    "text": "Tes inbound"
  }'`}</pre>
        </div>
      </div>
    </div>
  );
}
