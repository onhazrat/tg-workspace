from typing import Any

from pydantic import BaseModel, Field


class StartSyncJobRequest(BaseModel):
    channel_ids: list[str] | None = Field(None, alias="channelIds")
    source: str = "Manual"

    model_config = {"populate_by_name": True}


class StartSyncJobResponse(BaseModel):
    job_id: str = Field(..., alias="jobId")

    model_config = {"populate_by_name": True}


class ChannelSyncProgress(BaseModel):
    channel_id: str = Field(..., alias="channelId")
    channel_name: str = Field(..., alias="channelName")
    status: str
    posts_fetched: int = Field(0, alias="postsFetched")
    new_latest_id: int | None = Field(None, alias="newLatestId")
    error: str | None = None

    model_config = {"populate_by_name": True}


class SyncJobStatusResponse(BaseModel):
    job_id: str = Field(..., alias="jobId")
    status: str
    source: str
    channels: list[ChannelSyncProgress]
    created_at: int = Field(..., alias="createdAt")
    finished_at: int | None = Field(None, alias="finishedAt")

    model_config = {"populate_by_name": True}


class CancelSyncJobResponse(BaseModel):
    job_id: str = Field(..., alias="jobId")
    status: str

    model_config = {"populate_by_name": True}
