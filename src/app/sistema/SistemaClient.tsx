"use client";

import { useCallback, useEffect, useState } from "react";

type ProcStatus = { running: boolean; startedAt: string | null; lastLines: string[]; extra: Record<string, string> };
type ChromeStatus = ProcStatus & { cdpReachable: boolean };

type EnvForm = {
  INSTAGRAM_APP_SECRET: string;
  INSTAGRAM_PAGE_ACCESS_TOKEN: string;
  INSTAGRAM_WEBHOOK_VERIFY_TOKEN: string;
  INSTAGRAM_BUSINESS_ACCOUNT_ID: string;
  CLAUDEIA_API_KEY: string;
};

type BusinessForm = {
  ownerName: string;
  ownerRole: string;
  companyName: string;
  website: string;
  instagramHandle: string;
  whatsappNumber: string;
  affiliateGroup: string;
  oneLinePitch: string;
  howItWorks: string;
  revenueModel: string;
  verifiedClaims: string;
  unverifiedClaims: string;
  segments: string;
  keywords: string;
  affiliateTopics: string;
  country: string;
  region: string;
};

const EMPTY_BUSINESS: BusinessForm = {
  ownerName: "",
  ownerRole: "",
  companyName: "",
  website: "",
  instagramHandle: "",
  whatsappNumber: "",
  affiliateGroup: "",
  oneLinePitch: "",
  howItWorks: "",
  revenueModel: "",
  verifiedClaims: "",
  unverifiedClaims: "",
  segments: "",
  keywords: "",
  affiliateTopics: "",
  country: "Brasil",
  region: "Brasil",
};

const EMPTY_ENV: EnvForm = {
  INSTAGRAM_APP_SECRET: "",
  INSTAGRAM_PAGE_ACCESS_TOKEN: "",
  INSTAGRAM_WEBHOOK_VERIFY_TOKEN: "",
  INSTAGRAM_BUSINESS_ACCOUNT_ID: "",
  CLAUDEIA_API_KEY: "",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <h2 className="mb-3 text-sm font-semibold text-neutral-700 dark:text-neutral-300">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-neutral-600 dark:text-neutral-400">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900";

export default function SistemaClient() {
  const [chrome, setChrome] = useState<ChromeStatus | null>(null);
  const [tunnel, setTunnel] = useState<ProcStatus | null>(null);
  const [webhookTest, setWebhookTest] = useState<{ ok: boolean; error?: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const [business, setBusiness] = useState<BusinessForm>(EMPTY_BUSINESS);
  const [env, setEnv] = useState<EnvForm>(EMPTY_ENV);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [businessExists, setBusinessExists] = useState(false);

  const refresh = useCallback(async () => {
    const [c, t] = await Promise.all([
      fetch("/api/sistema/chrome").then((r) => r.json()),
      fetch("/api/sistema/tunnel").then((r) => r.json()),
    ]);
    setChrome(c);
    setTunnel(t);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    fetch("/api/sistema/config")
      .then((r) => r.json())
      .then((data: { business: Record<string, unknown> | null; env: EnvForm }) => {
        setEnv(data.env);
        if (data.business) {
          const b = data.business as {
            owner: { name: string; role: string };
            company: { name: string; website: string; instagramHandle: string };
            links: { whatsapp: string; affiliateGroup: string | null };
            pitch: { oneLine: string; howItWorks: string[]; revenueModel: string[] };
            verifiedClaims: string[];
            unverifiedClaims: string[];
            icp: { segments: string[]; keywords: string[] };
            affiliateTopics: string[];
            geography: { country: string; region: string };
          };
          setBusinessExists(true);
          setBusiness({
            ownerName: b.owner.name,
            ownerRole: b.owner.role,
            companyName: b.company.name,
            website: b.company.website,
            instagramHandle: b.company.instagramHandle,
            whatsappNumber: b.links.whatsapp,
            affiliateGroup: b.links.affiliateGroup ?? "",
            oneLinePitch: b.pitch.oneLine,
            howItWorks: b.pitch.howItWorks.join("\n"),
            revenueModel: b.pitch.revenueModel.join("\n"),
            verifiedClaims: b.verifiedClaims.join("\n"),
            unverifiedClaims: b.unverifiedClaims.join("\n"),
            segments: b.icp.segments.join("\n"),
            keywords: b.icp.keywords.join("\n"),
            affiliateTopics: b.affiliateTopics.join("\n"),
            country: b.geography.country,
            region: b.geography.region,
          });
        }
      });
  }, []);

  async function toggleChrome() {
    await fetch("/api/sistema/chrome", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: chrome?.running || chrome?.cdpReachable ? "stop" : "start" }),
    });
    refresh();
  }

  async function toggleTunnel() {
    await fetch("/api/sistema/tunnel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: tunnel?.running ? "stop" : "start", port: 3000 }),
    });
    refresh();
  }

  async function testWebhook() {
    if (!tunnel?.extra.url) return;
    setTesting(true);
    setWebhookTest(null);
    const res = await fetch(`/api/sistema/webhook-test?url=${encodeURIComponent(tunnel.extra.url)}`).then((r) =>
      r.json(),
    );
    setWebhookTest(res);
    setTesting(false);
  }

  async function saveConfig() {
    setSaving(true);
    setSaveMsg(null);
    const res = await fetch("/api/sistema/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ business, env }),
    }).then((r) => r.json());
    setSaving(false);
    setSaveMsg(
      res.ok
        ? "Salvo. Reinicie o sistema (feche e abra o iniciar-brasztech.bat) para as chaves da Meta/IA valerem."
        : `Erro: ${res.error}`,
    );
    if (res.ok) setBusinessExists(true);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Sistema</h1>
      <p className="text-sm text-neutral-500">
        Controles do que antes precisava de terminal: Chrome com depuração, túnel público para o webhook da Meta, e
        os dados do negócio / chaves de API.
      </p>

      <Section title="1. Chrome (envio da 1ª mensagem)">
        <div className="flex items-center gap-3">
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${chrome?.cdpReachable ? "bg-emerald-500" : "bg-neutral-400"}`}
          />
          <span className="text-sm">
            {chrome?.cdpReachable ? "Chrome aberto e pronto" : "Chrome não está aberto com depuração"}
          </span>
          <button
            onClick={toggleChrome}
            className="ml-auto rounded border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            {chrome?.cdpReachable ? "Fechar" : "Abrir Chrome"}
          </button>
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          Na primeira vez, uma janela do Chrome vai abrir vazia. Faça login no Instagram nela, uma única vez.
        </p>
      </Section>

      <Section title="2. Túnel público (para o webhook da Meta)">
        <div className="flex items-center gap-3">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${tunnel?.running ? "bg-emerald-500" : "bg-neutral-400"}`} />
          <span className="text-sm">{tunnel?.running ? "Túnel ativo" : "Túnel desligado"}</span>
          <button
            onClick={toggleTunnel}
            className="ml-auto rounded border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            {tunnel?.running ? "Parar" : "Iniciar túnel"}
          </button>
        </div>
        {tunnel?.extra.url ? (
          <div className="mt-3 space-y-2">
            <Field label="URL do webhook (cole isso na Meta, campo 'URL de callback')">
              <div className="flex gap-2">
                <input
                  readOnly
                  value={`${tunnel.extra.url}/api/webhooks/instagram`}
                  className={inputCls}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button
                  onClick={() => navigator.clipboard.writeText(`${tunnel.extra.url}/api/webhooks/instagram`)}
                  className="shrink-0 rounded border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
                >
                  Copiar
                </button>
              </div>
            </Field>
            <div className="flex items-center gap-2">
              <button
                onClick={testWebhook}
                disabled={testing}
                className="rounded border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
              >
                {testing ? "Testando..." : "Testar"}
              </button>
              {webhookTest ? (
                <span className={`text-xs ${webhookTest.ok ? "text-emerald-600" : "text-red-600"}`}>
                  {webhookTest.ok ? "OK, pode colar na Meta." : webhookTest.error}
                </span>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="mt-2 text-xs text-neutral-500">
            Cada vez que o túnel é iniciado, a URL muda. Depois de iniciar, copie a URL nova para a Meta de novo.
          </p>
        )}
      </Section>

      <Section title="3. Negócio (o que a IA fala em nome dele)">
        {!businessExists ? (
          <p className="mb-3 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            Ainda não configurado. Preencha e salve antes de ligar o sistema.
          </p>
        ) : null}
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Seu nome">
            <input className={inputCls} value={business.ownerName} onChange={(e) => setBusiness({ ...business, ownerName: e.target.value })} />
          </Field>
          <Field label="Seu cargo/papel">
            <input className={inputCls} value={business.ownerRole} onChange={(e) => setBusiness({ ...business, ownerRole: e.target.value })} />
          </Field>
          <Field label="Nome da empresa">
            <input className={inputCls} value={business.companyName} onChange={(e) => setBusiness({ ...business, companyName: e.target.value })} />
          </Field>
          <Field label="Site (com https://)">
            <input className={inputCls} value={business.website} onChange={(e) => setBusiness({ ...business, website: e.target.value })} />
          </Field>
          <Field label="Usuário do Instagram (sem @)">
            <input className={inputCls} value={business.instagramHandle} onChange={(e) => setBusiness({ ...business, instagramHandle: e.target.value })} />
          </Field>
          <Field label="WhatsApp (número com DDD e país, só dígitos)">
            <input className={inputCls} placeholder="5544999999999" value={business.whatsappNumber} onChange={(e) => setBusiness({ ...business, whatsappNumber: e.target.value })} />
          </Field>
          <Field label="Grupo de afiliados (opcional)">
            <input className={inputCls} value={business.affiliateGroup} onChange={(e) => setBusiness({ ...business, affiliateGroup: e.target.value })} />
          </Field>
          <Field label="País/região">
            <input className={inputCls} value={business.country} onChange={(e) => setBusiness({ ...business, country: e.target.value, region: e.target.value })} />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="Frase de apresentação (o que a empresa faz, 1 linha)">
            <input className={inputCls} value={business.oneLinePitch} onChange={(e) => setBusiness({ ...business, oneLinePitch: e.target.value })} />
          </Field>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Field label="Como funciona (1 passo por linha)">
            <textarea rows={3} className={inputCls} value={business.howItWorks} onChange={(e) => setBusiness({ ...business, howItWorks: e.target.value })} />
          </Field>
          <Field label="Como a empresa ganha dinheiro (1 por linha)">
            <textarea rows={3} className={inputCls} value={business.revenueModel} onChange={(e) => setBusiness({ ...business, revenueModel: e.target.value })} />
          </Field>
          <Field label="Segmentos que você atende (1 por linha)">
            <textarea rows={3} className={inputCls} value={business.segments} onChange={(e) => setBusiness({ ...business, segments: e.target.value })} />
          </Field>
          <Field label="Palavras-chave de busca no Instagram (1 por linha)">
            <textarea rows={3} className={inputCls} value={business.keywords} onChange={(e) => setBusiness({ ...business, keywords: e.target.value })} />
          </Field>
          <Field label="Afirmações comprovadas (a IA só pode falar isso, 1 por linha)">
            <textarea rows={3} className={inputCls} value={business.verifiedClaims} onChange={(e) => setBusiness({ ...business, verifiedClaims: e.target.value })} />
          </Field>
          <Field label="Afirmações NÃO comprovadas (bloqueadas, 1 por linha)">
            <textarea rows={3} className={inputCls} value={business.unverifiedClaims} onChange={(e) => setBusiness({ ...business, unverifiedClaims: e.target.value })} />
          </Field>
        </div>
      </Section>

      <Section title="4. Chaves de API (Instagram/Meta e IA)">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Chave da IA (Claude / Anthropic)">
            <input type="password" className={inputCls} value={env.CLAUDEIA_API_KEY} onChange={(e) => setEnv({ ...env, CLAUDEIA_API_KEY: e.target.value })} />
          </Field>
          <Field label="Token de verificação do webhook (você escolhe, ex: minhaempresa-wh-2026)">
            <input className={inputCls} value={env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN} onChange={(e) => setEnv({ ...env, INSTAGRAM_WEBHOOK_VERIFY_TOKEN: e.target.value })} />
          </Field>
          <Field label="App Secret (painel da Meta)">
            <input type="password" className={inputCls} value={env.INSTAGRAM_APP_SECRET} onChange={(e) => setEnv({ ...env, INSTAGRAM_APP_SECRET: e.target.value })} />
          </Field>
          <Field label="Token de acesso da página (painel da Meta)">
            <input type="password" className={inputCls} value={env.INSTAGRAM_PAGE_ACCESS_TOKEN} onChange={(e) => setEnv({ ...env, INSTAGRAM_PAGE_ACCESS_TOKEN: e.target.value })} />
          </Field>
          <Field label="ID da conta comercial do Instagram">
            <input className={inputCls} value={env.INSTAGRAM_BUSINESS_ACCOUNT_ID} onChange={(e) => setEnv({ ...env, INSTAGRAM_BUSINESS_ACCOUNT_ID: e.target.value })} />
          </Field>
        </div>
      </Section>

      <div className="flex items-center gap-3">
        <button
          onClick={saveConfig}
          disabled={saving}
          className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {saving ? "Salvando..." : "Salvar tudo"}
        </button>
        {saveMsg ? <span className="text-sm text-neutral-600 dark:text-neutral-400">{saveMsg}</span> : null}
      </div>
    </div>
  );
}
