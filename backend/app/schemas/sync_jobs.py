from typing import Literal

from pydantic import BaseModel, Field, model_validator


class StartSyncJobRequest(BaseModel):
    channel_ids: list[str] | None = Field(None, alias="channelIds")
    source: str = "Manual"
    sync_mode: (
        Literal["sync_all", "bulk", "individual", "recheck_restricted"] | None
    ) = Field(default=None, alias="syncMode")

    model_config = {"populate_by_name": True}

    @model_validator(mode="after")
    def default_sync_mode(self) -> StartSyncJobRequest:
        if self.sync_mode is None:
            self.sync_mode = "bulk" if self.channel_ids else "sync_all"
        return self

    @property
    def resolved_sync_mode(
        self,
    ) -> Literal["sync_all", "bulk", "individual", "recheck_restricted"]:
        if self.sync_mode is not None:
            return self.sync_mode
        return "bulk" if self.channel_ids else "sync_all"


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
