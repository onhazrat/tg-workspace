from pydantic import BaseModel, Field


class JobStatusEntry(BaseModel):
    enabled: bool = True
    last_run: int | None = Field(None, alias="lastRun")
    last_status: str = Field("idle", alias="lastStatus")
    last_error: str | None = Field(None, alias="lastError")
    next_run: int | None = Field(None, alias="nextRun")
    pause_until: int | None = Field(None, alias="pauseUntil")

    model_config = {"populate_by_name": True}


class JobsStatusResponse(BaseModel):
    auto_sync: JobStatusEntry
    embeddings: JobStatusEntry
    auto_summary: JobStatusEntry
    retention: JobStatusEntry
    translation_batch: JobStatusEntry


class UpdateJobRequest(BaseModel):
    enabled: bool
