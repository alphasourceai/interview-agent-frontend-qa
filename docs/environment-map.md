# 🧭 Interview Agent — Environment & Deployment Reference

## 🔹 Overview
This document outlines the **branching, environment, and deployment structure** for the Interview Agent platform.  
It ensures QA, Staging, and Production environments remain synchronized and predictable during active development.

---

## 🧱 Repositories

| Repo | Purpose | Primary Branches |
|------|----------|------------------|
| **interview-agent-backend** | Express-based API, Supabase integration, Tavus + OpenAI logic | `qa-backend`, `staging-backend`, `prod-backend-legacy` |
| **interview-agent-frontend** | React/Vite-based dashboard + candidate UI | `qa-frontend`, `staging-frontend`, `prod-frontend-legacy` |

---

## ☁️ Render Services

| Render Service | Type | Connected Branch | Environment Purpose |
|----------------|------|------------------|----------------------|
| `ia-backend-qa` | Web Service | `qa-backend` | Dev/QA testing builds |
| `ia-backend-staging` | Web Service | `staging-backend` | Pre-production validation (UAT) |
| `ia-backend-prod` | Web Service | `prod-backend-legacy` | Live Production backend |
| `ia-frontend-qa` | Static Site | `qa-frontend` | Dev/QA frontend |
| `ia-frontend-staging` | Static Site | `staging-frontend` | Pre-production frontend |
| `ia-frontend-prod` | Static Site | `prod-frontend-legacy` | Live Production frontend |

---

## 🧭 Domain Map

| Domain | Destination | Purpose |
|--------|--------------|----------|
| **https://www.alphasourceai.com** | Wix (temporary marketing site) | Public marketing pages |
| **https://interviews.alphasourceai.com** | Render → `ia-backend-prod` | Branded interview access subdomain |
| **https://ia-frontend-prod.onrender.com** | Frontend Production | User portal (Prod) |
| **https://ia-frontend-staging.onrender.com** | Frontend Staging | Pre-prod verification |
| **https://ia-frontend-qa.onrender.com** | Frontend QA | Developer test builds |

---

## 🧩 Branch & Promotion Flow

```mermaid
graph TD
  A[feature/*] --> B[qa-backend / qa-frontend]
  B --> C[staging-backend / staging-frontend]
  C --> D[prod-backend-legacy / prod-frontend-legacy]
```

### Rules
- **New features** → always start from `qa-*`.
- **QA** → for dev validation.
- **Staging** → for pre-prod testing & UAT.
- **Prod** → final production release only via merges from staging.

---

## ⚙️ Promotion Commands

### Promote QA → Staging
```bash
git checkout staging-backend
git merge qa-backend --no-ff -m "Promote QA → Staging"
git push origin staging-backend

git checkout staging-frontend
git merge qa-frontend --no-ff -m "Promote QA → Staging"
git push origin staging-frontend
```

### Promote Staging → Prod
```bash
git checkout prod-backend-legacy
git merge staging-backend --no-ff -m "Promote Staging → Prod"
git push origin prod-backend-legacy

git checkout prod-frontend-legacy
git merge staging-frontend --no-ff -m "Promote Staging → Prod"
git push origin prod-frontend-legacy
```

---

## 🧾 Environment Variables

| Environment | File / Render Service | Notes |
|--------------|----------------------|--------|
| **QA** | `.env.qa` or Render “QA” | Mirrors prod but with test Supabase + Tavus keys |
| **Staging** | `.env.staging` | Uses staging Supabase + PDFMonkey templates |
| **Prod** | `.env.prod` | Live connections and API keys |

---

## 🔒 GitHub Branch Protection

| Branch | Protection |
|---------|-------------|
| `prod-backend-legacy` | PRs only (no direct pushes) |
| `prod-frontend-legacy` | PRs only (no direct pushes) |
| `staging-*` | Optional review for merges |
| `qa-*` | Open for development |

---

## 🧪 Verification Flow

| Step | Verification | Criteria |
|------|---------------|-----------|
| 1 | QA Deploy | Builds, API routes, role creation |
| 2 | Staging Deploy | Token flow, link generation, UI validation |
| 3 | Prod Deploy | Cam/mic prompts, email triggers, PDF generation |

---

## 🧰 Local Development Layout

```
/interview-agent-backend
  ├── qa/
  ├── staging/
  └── prod/
  
/interview-agent-frontend
  ├── qa/
  ├── staging/
  └── prod/
```

Use these local directories for testing before pushing to the appropriate branch.

---

## 🚀 Promotion Summary

| Flow | Source → Destination | Trigger |
|------|----------------------|----------|
| **Dev → QA** | Local → `qa-*` | Developer push |
| **QA → Staging** | `qa-*` → `staging-*` | Internal validation complete |
| **Staging → Prod** | `staging-*` → `prod-*-legacy` | MVP verified and approved |
