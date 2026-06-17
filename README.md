# GeoInsights Chat

**A chat application for exploring structured datasets of geopolitical events.**

GeoInsights Chat lets you ask natural-language questions about a database of geopolitical incidents: cyberattacks, military aid, military offensives, sanctions, and international summits, and get back narrative answers, charts, tables, and full "deep research" reports. Under the hood it combines semantic + keyword retrieval, an LLM, and a sandboxed Python code interpreter that writes and runs analysis code against the dataset.

The structured datasets it queries are produced by a companion pipeline: **[nmikati3/geoinsights-data](https://github.com/nmikati3/geoinsights-data)**, which turns global news from the [GDELT](https://www.gdeltproject.org/) database into a deduplicated, structured database of geopolitical incidents.

This is a research project shared as-is to demonstrate an approach to chatting with structured event data. It is not a finished product.

---

## Features

- **Conversational analytics**: ask questions in plain English about geopolitical incidents.
- **Code-interpreter analysis** — an LLM writes Python that runs in an isolated [E2B](https://e2b.dev) sandbox to compute statistics and generate Plotly figures and tables.
- **Deep research mode**: multi-step research that compresses findings into a comprehensive report.
- **Hybrid retrieval**: FAISS embeddings + BM25 (`rank_bm25`) with a cross-encoder reranker.
- **Dashboards**: pin figures and tables into shareable dashboards with PDF export.
- **Authentication**: Firebase Authentication with per-user data isolation in Firestore.

## Architecture

```
┌─────────────────┐        ┌──────────────────────┐        ┌─────────────────────┐
│  Frontend (SPA) │  /api  │  Backend (FastAPI)   │        │  E2B code sandbox   │
│  React + Vite   │ ─────► │  retrieval + LLM     │ ─────► │  runs analysis code │
│  Firebase Auth  │        │  + deep research     │        └─────────────────────┘
└─────────────────┘        └──────────┬───────────┘
                                       │
                         ┌─────────────┼───────────────┐
                         ▼             ▼               ▼
                    Google Cloud   Firestore       OpenAI API
                    Storage        (chats /         (LLM +
                    (datasets)     dashboards)      embeddings)
```

- `**frontend/**` — React + TypeScript (Vite) single-page app. In production it's served by a small Express server (`server.js`) that proxies `/api` to the backend and injects a GCP identity token for service-to-service auth on Cloud Run.
- `**backend/**` — FastAPI service (`geoinsights_backend`) that handles retrieval, LLM calls, the deep-research workflow, and sandboxed code execution. Datasets are loaded from Google Cloud Storage; conversations and dashboards are persisted in Firestore.

## Tech stack

Python 3.12 · FastAPI · OpenAI · E2B Code Interpreter · FAISS · sentence-transformers · rank_bm25 · pandas / pyarrow · Plotly · Firebase Admin (Auth + Firestore) · Google Cloud Storage · React · TypeScript · Vite · Docker · Google Cloud Run.

---

## Getting started

### Prerequisites

- Python 3.12+ and Node.js 20+
- A Google Cloud project with a Cloud Storage bucket and Firestore enabled
- A Firebase project (for Authentication)
- An [OpenAI API key](https://platform.openai.com/) and an [E2B API key](https://e2b.dev/)
- The datasets produced by [geoinsights-data](https://github.com/nmikati3/geoinsights-data), uploaded to your GCS bucket

### Backend

```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r ../requirements.txt

# Authenticate to GCP for Application Default Credentials (Firestore + Storage + Firebase Admin)
gcloud auth application-default login

# Set the environment variables (see table below), then run:
RUN=dev uvicorn geoinsights_backend.api.main:app --host 0.0.0.0 --port 8000
```

### Frontend

```bash
cd frontend
npm install

# Create frontend/.env with the VITE_* variables (see table below), then:
npm run dev
```

---

## Configuration

Everything is configured through environment variables — **no secrets are stored in the repo.**

### Backend


| Variable                        | Required | Description                                                                  |
| ------------------------------- | -------- | ---------------------------------------------------------------------------- |
| `OPENAI_API_KEY`                | ✅        | OpenAI API key (chat + embeddings).                                          |
| `E2B_API_KEY`                   | ✅        | E2B API key for the code-interpreter sandbox.                                |
| `BUCKET_NAME`                   | ✅        | GCS bucket holding the dataset files.                                        |
| `RUN`                           | ✅        | `dev` enables docs/CORS for local dev; anything else = production.           |
| `MAX_TOKENS`                    | ✅        | Max tokens for standard LLM responses.                                       |
| `PROJECT_ID`                    |          | GCP project ID for Firestore.                                                |
| `FIRESTORE_DATABASE`            |          | Firestore database name.                                                     |
| `DEMO_BUCKET_NAME`              |          | Optional separate bucket for the demo dataset (falls back to `BUCKET_NAME`). |
| `MODEL_NAME`                    |          | OpenAI model for standard responses.                                         |
| `SEARCH_MODEL_NAME`             |          | Model used for web/search-style answers.                                     |
| `DEEP_RESEARCH_MODEL_NAME`      |          | Model used for the deep-research workflow.                                   |
| `CODE_MODEL_NAME`               |          | Model used to generate analysis code.                                        |
| `MAX_TOKENS_COMPRESSION`        |          | Token budget for research compression (default `1000`).                      |
| `MAX_TOKENS_FINAL_REPORT`       |          | Token budget for the final report (default `1500`).                          |
| `MAX_CONCURRENT_RESEARCH_UNITS` |          | Concurrency for deep research (default `5`).                                 |
| `MAX_RESEARCHER_ITERATIONS`     |          | Max research iterations (default `5`).                                       |
| `ALLOWED_HOSTS`                 |          | Comma-separated allowed hosts (TrustedHostMiddleware).                       |
| `CORS_ORIGINS`                  |          | Comma-separated allowed CORS origins for production.                         |


Firebase Admin uses Application Default Credentials, so no service-account key is needed in the repo.

### Frontend


| Variable                            | Required | Description                      |
| ----------------------------------- | -------- | -------------------------------- |
| `VITE_BACKEND_URL`                  | ✅        | Backend origin the SPA talks to. |
| `VITE_FIREBASE_API_KEY`             | ✅        | Firebase Web API key.            |
| `VITE_FIREBASE_AUTH_DOMAIN`         | ✅        | Firebase Auth domain.            |
| `VITE_FIREBASE_PROJECT_ID`          | ✅        | Firebase project ID.             |
| `VITE_FIREBASE_STORAGE_BUCKET`      | ✅        | Firebase storage bucket.         |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | ✅        | Firebase messaging sender ID.    |
| `VITE_FIREBASE_APP_ID`              | ✅        | Firebase app ID.                 |


> When deploying, also update the Content-Security-Policy `connect-src` placeholders in
> `frontend/index.html` (`YOUR_FIREBASE_PROJECT` and `YOUR_BACKEND_URL`) and the default
> project in `frontend/.firebaserc` to match your own deployment.

---

## Deployment

Both services ship with a `Dockerfile`. The frontend includes a `cloudbuild.yaml` for building
and deploying to Google Cloud Run via Cloud Build (build-time `VITE_`* values are passed as
substitutions). The backend runs as a containerized FastAPI app behind Cloud Run, with the
frontend proxying authenticated requests to it.

## Related repositories

- **[geoinsights-data](https://github.com/nmikati3/geoinsights-data)** — the pipeline that builds the structured geopolitical-event datasets this app queries.

## License

Licensed under the Apache License 2.0 — see [LICENSE](./LICENSE).