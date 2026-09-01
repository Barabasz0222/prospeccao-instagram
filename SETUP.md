# Manual do operador — BraszTech Prospecção no Instagram

Sistema local que automatiza a prospecção da BraszTech no Instagram:
**Observar → Decidir → Agir → Medir → Aprender → Adaptar**, dentro dos limites
do `.env` e do painel. Fora deles, o sistema pausa e chama você.

---

## 1. Pré-requisitos

- **Node.js 22 LTS ou superior** (`node -v`)
- **pnpm 9+** (`npm i -g pnpm`)
- **Google Chrome** (para o primeiro contato pelo navegador — etapa opcional no início)

```bash
pnpm install
```

---

## 2. Configuração do negócio

```bash
cp config/business.example.json config/business.json
```

Preencha **todos** os campos. O arquivo `config/business.json` é a única fonte
de dados reais do negócio — nada de valor real fica no código. Ele está no
`.gitignore` e **não pode ser versionado**.

Regra de afirmações: a IA só envia o que está em `verifiedClaims`. Qualquer
coisa em `unverifiedClaims` fica **bloqueada** até você comprovar no site e
mover para `verifiedClaims`.

---

## 3. Variáveis de ambiente

```bash
cp .env.example .env
```

### 3.1 Chave da IA (Claude / Anthropic)

1. Crie a chave em <https://console.anthropic.com/settings/keys>, **num
   projeto separado** e com permissão restrita.
2. Defina um **limite de gasto mensal (hard limit)** nas configurações de
   billing do console.
3. Coloque em `CLAUDEIA_API_KEY`.
4. `CLAUDEIA_MODEL` e `CLAUDEIA_MODEL_FAST` usam **nomes exatos de modelo** —
   sem alias flutuante em produção.
5. `CLAUDEIA_MONTHLY_BUDGET_USD` é o teto interno. Ao atingir, o sistema pausa
   sozinho antes de qualquer nova chamada.

### 3.2 Instagram / Meta (API oficial + webhook)

Preencha `INSTAGRAM_APP_SECRET`, `INSTAGRAM_PAGE_ACCESS_TOKEN`,
`INSTAGRAM_WEBHOOK_VERIFY_TOKEN`, `INSTAGRAM_BUSINESS_ACCOUNT_ID` com os dados
do seu app na Meta. O webhook deve apontar para:

```
https://SEU_DOMINIO/api/webhooks/instagram
```

Passos completos: **API do Instagram com login do Instagram** → pegue
`app secret`, gere o **token de longa duração (60 dias)** e o **ID da conta**;
webhook com o campo `messages`; permissões `instagram_business_basic` e
`instagram_business_manage_messages`.

O token de 60 dias é **renovado automaticamente** pelo worker (job
`refresh_ig_token`, 1×/dia; guardado na tabela `settings`, `.env` vira só o
bootstrap inicial). Se a renovação falhar, aparece um alerta crítico em
Exceções.

Enquanto não houver app configurado, o restante do sistema continua funcionando —
só o handoff para a API oficial fica parado e as respostas vão para a fila de
exceções (você responde na mão pelo Instagram).

### 3.3 Chrome com perfil dedicado (primeiro contato pelo navegador)

> ⚠️ **A porta de debug dá controle total sobre a sessão logada.**
> Mantenha em `127.0.0.1`. **Nunca** `0.0.0.0`. **Nunca** em máquina
> compartilhada.

Use um **perfil dedicado**, separado do seu perfil pessoal (o Chrome 136+
recusa `--remote-debugging-port` no perfil padrão).

**Windows (PowerShell):**
```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir="$PWD\.chrome-profile"
```

**macOS:**
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$PWD/.chrome-profile"
```

**Linux:**
```bash
google-chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$PWD/.chrome-profile"
```

Na janela que abrir, **faça login no Instagram uma única vez, na mão**. O
agente abre a **própria aba**, nunca toma seu mouse/teclado e fecha a aba ao
terminar.

Defina no `.env`:
```
CHROME_CDP_URL=http://127.0.0.1:9222
CHROME_PROFILE_DIR=./.chrome-profile
```

### 3.4 Modo de envio pelo navegador

`BROWSER_SEND_MODE`:

| Modo         | O que faz                                                        |
|--------------|-----------------------------------------------------------------|
| `simulation` | Nenhum navegador real. Driver falso registra tudo. **Padrão.** |
| `dry_run`    | Abre o Chrome real, compõe a mensagem, **não clica em enviar**. |
| `live`       | Envia de verdade. Só depois de você autorizar.                 |

---

### 3.5 Ingestão de sinais externos (opcional)

`INGEST_TOKEN` habilita `POST /api/ingest/lifecycle` para o seu CRM / billing /
portal de afiliados marcarem o avanço do lead (o sistema **não** infere isso da
conversa):

```bash
curl -X POST http://localhost:3000/api/ingest/lifecycle \
  -H "Authorization: Bearer $INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"active_customer","igUsername":"construtora.exemplo"}'
```

Tipos: `registered`, `active_customer`, `affiliate_joined`,
`affiliate_generated_customer`. Sem token, o endpoint fica desativado (401).
Você também pode marcar manualmente na tela do lead.

## 4. Banco de dados

```bash
pnpm db:migrate      # aplica migrações
pnpm db:backup       # backup manual (o worker também faz a cada 6h, com retenção)
pnpm db:restore      # restaura do backup mais recente (pare o app antes)
pnpm db:restore backups/app.db.2026-....bak   # restaura de um específico
```

O banco é SQLite (`data/app.db`), fonte única de verdade. Backups em `backups/`.

---

## 5. Rodar

```bash
pnpm dev     # sobe painel (localhost:3000) + worker, um comando só
```

Produção local:
```bash
pnpm build && pnpm start   # painel
pnpm worker                 # worker, em outro terminal
```

---

## 6. Pausar

- **Painel → botão "Pausar tudo"** (canto superior direito do Painel geral).
- O sistema **pausa sozinho** diante de: alerta/restrição do Instagram, perda
  de sessão, crescimento anormal de erros, mensagem duplicada, aumento de
  bloqueios/opt-out, divergência navegador/API/CRM, comportamento inesperado
  da IA, estouro do orçamento de IA.
- Retomar: mesmo botão, depois de resolver a causa (ver **Exceções**).

---

## 7. Se a chave da IA vazar

1. Revogue a chave em <https://console.anthropic.com/settings/keys> **agora**.
2. Gere uma nova, atualize `CLAUDEIA_API_KEY` no `.env`, reinicie.
3. Confira o gasto no console da Anthropic e ajuste o hard limit.
4. O `.env` está no `.gitignore` — confirme que nunca foi commitado
   (`git log -p -- .env` deve vir vazio).

---

## 8. Ordem recomendada de ativação

1. `simulation` — rode o fluxo ponta a ponta:
   ```bash
   pnpm sim                       # fluxo completo em memória (descoberta → cliente ativo)
   pnpm seed && pnpm drain        # popula data/app.db e processa a fila
   pnpm dev                       # abra http://localhost:3000
   ```
2. `dry_run` — valide o primeiro contato no Chrome real, **sem enviar**:
   ```bash
   BROWSER_SEND_MODE=dry_run pnpm tsx scripts/browser-smoke.ts @perfil_teste "sua mensagem"
   ```
3. **Autorização explícita sua** → `live` com `MAX_DMS_PER_DAY` baixo:
   ```bash
   SMOKE_CONFIRM=eu-autorizo BROWSER_SEND_MODE=live pnpm tsx scripts/browser-smoke.ts @perfil "mensagem"
   ```
4. Piloto limitado (aquecimento: 5/dia na 1ª semana, +5 por semana).
5. Autonomia total dentro dos limites.

## 8b. Descoberta autônoma

Com `pnpm dev` rodando, o worker **descobre leads sozinho** a cada 8h
(ajustável em Configurações → "Descoberta: intervalo"):

1. Lê `config/business.json` → `icp.keywords` + `icp.segments` (funil clientes) e
   `affiliateTopics` (funil afiliados)
2. Cada termo vira uma hashtag (`gestão de obras` → `#gestaodeobras`) + uma busca
3. Abre a página da hashtag, rola, pega os posts recentes → abre cada post → pega o autor
4. Visita cada perfil, lê bio/categoria/seguidores/link do HTML (`enrich_profile`)
5. Pontua contra o ICP, qualifica os que passam, gera a abertura, manda a 1ª DM

Você não precisa fazer nada — só manter `config/business.json` com termos bons.
Para adicionar hashtags específicas: Configurações, ou via `discovery.extra_hashtags`
nas settings.

`pnpm add-leads` continua disponível se quiser injetar perfis específicos na mão
(esses pulam o filtro de score).

## 9. Ajustar o scraping real do Instagram

Os seletores em `src/integrations/browser/cdp-driver.ts` (`discoverProfiles` e
`sendDm`) são um ponto de partida — o DOM do Instagram muda. Rode em `dry_run`,
observe o `screenshot`/`a11y.json` em `screenshots/` quando algo falhar, e
ajuste os `getByRole` / seletores. Nada de scraping é obrigatório para os
testes: o modo `simulation` usa um driver falso.
