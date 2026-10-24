# ADR-001: Repository Layout

**Status:** Accepted

**Decision:** Full FastAPI template monorepo. TG-Summarizer UI in `frontend/`, Python in `backend/`.

**Porting steps:**
1. Copy `TG-Summarizer/src` → `frontend/src`
2. Copy vite/tsconfig/index.html from TG-Summarizer
3. Keep template Docker, scripts, Alembic scaffolding
4. Retain `TG-Summarizer/` as reference until migration verified
