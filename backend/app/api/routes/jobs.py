from fastapi import APIRouter

from app.jobs.scheduler import get_job_status

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.get("/status")
def jobs_status() -> dict:
    return get_job_status()
